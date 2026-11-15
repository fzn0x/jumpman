"""
Exports the on-device sky segmentation model used by Jumpman's sky masks.

Source: EfficientViT-Seg B1 trained on ADE20K, by MIT Han Lab (Apache-2.0),
https://github.com/mit-han-lab/efficientvit and
https://huggingface.co/han-cai/efficientvit-seg (efficientvit_seg_b1_ade20k.pt).

Changes made here (Apache-2.0 section 4b): the network is wrapped with a
softmax over the 150 ADE20K classes and only the sky probability (class 2) is
kept, then exported to ONNX with dynamic height and width. Weights are stored
as float16 and cast back to float32 when the model loads, which halves the
download; the network still computes in float32.

Run once by hand, not in CI. The repo's imports also need torchvision, timm,
onnxsim, omegaconf and segment_anything:

    python -m venv venv && venv/bin/pip install torch torchvision onnx onnxruntime \
        einops timm onnxsim omegaconf segment_anything
    git clone https://github.com/mit-han-lab/efficientvit
    curl -LO https://huggingface.co/han-cai/efficientvit-seg/resolve/main/efficientvit_seg_b1_ade20k.pt
    venv/bin/python scripts/export-sky-model.py --repo efficientvit \
        --weights efficientvit_seg_b1_ade20k.pt --out apps/web/src/assets/models/sky_b1.onnx
"""

import argparse
import sys

import numpy as np
import torch

SKY = 2  # ADE20K: wall, building, sky, ...


def store_weights_fp16(path: str) -> None:
    """Stores float32 weights as float16 initializers, each followed by a Cast to float32."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    model = onnx.load(path)
    graph = model.graph
    casts, halves = [], []
    for init in list(graph.initializer):
        if init.data_type == TensorProto.FLOAT and int(np.prod(init.dims)) >= 16:
            half = numpy_helper.from_array(
                numpy_helper.to_array(init).astype(np.float16), init.name + "_f16"
            )
            graph.initializer.remove(init)
            halves.append(half)
            casts.append(helper.make_node("Cast", [half.name], [init.name], to=TensorProto.FLOAT))
    graph.initializer.extend(halves)
    nodes = casts + list(graph.node)
    del graph.node[:]
    graph.node.extend(nodes)
    onnx.checker.check_model(model)
    onnx.save(model, path)


class SkyHead(torch.nn.Module):
    """Input: NCHW float32, ImageNet-normalized RGB. Output: N x 1 x H/8 x W/8 sky probability."""

    def __init__(self, net: torch.nn.Module) -> None:
        super().__init__()
        self.net = net

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return torch.softmax(self.net(x), dim=1)[:, SKY : SKY + 1]


def stub_triton() -> None:
    """
    The repo imports a Triton RMS-norm kernel at import time, and Triton has no
    Windows or macOS wheels. B1 uses batch norm and never calls that kernel, so
    where Triton is missing the kernel module is replaced by a placeholder.
    """
    try:
        import triton  # noqa: F401
    except ImportError:
        import types

        module = types.ModuleType("efficientvit.models.nn.triton_rms_norm")

        class TritonRMSNorm2dFunc:
            @staticmethod
            def apply(*_args):
                raise RuntimeError("Triton RMS norm is not available here")

        module.TritonRMSNorm2dFunc = TritonRMSNorm2dFunc
        module.__all__ = ["TritonRMSNorm2dFunc"]
        sys.modules[module.__name__] = module


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--repo", required=True, help="Path to a clone of mit-han-lab/efficientvit")
    p.add_argument("--weights", required=True, help="efficientvit_seg_b1_ade20k.pt")
    p.add_argument("--out", required=True)
    args = p.parse_args()

    sys.path.insert(0, args.repo)
    stub_triton()
    from efficientvit.seg_model_zoo import create_efficientvit_seg_model

    net = create_efficientvit_seg_model("efficientvit-seg-b1-ade20k", weight_url=args.weights)
    model = SkyHead(net).eval()

    dummy = torch.randn(1, 3, 512, 352)
    torch.onnx.export(
        model,
        (dummy,),
        args.out,
        input_names=["image"],
        output_names=["sky"],
        dynamic_axes={"image": {2: "height", 3: "width"}, "sky": {2: "h8", 3: "w8"}},
        opset_version=17,
        dynamo=False,
    )

    store_weights_fp16(args.out)

    # Check the export against PyTorch at a different size.
    import onnxruntime as ort

    x = torch.randn(1, 3, 384, 512)
    with torch.no_grad():
        want = model(x).numpy()
    got = ort.InferenceSession(args.out).run(None, {"image": x.numpy()})[0]
    diff = float(np.abs(got - want).max())
    print("shape", got.shape, "max abs diff", diff)
    if diff > 0.05:
        raise SystemExit("The exported model differs too much from PyTorch")


if __name__ == "__main__":
    main()
