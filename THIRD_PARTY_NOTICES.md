# Third-party notices

Jumpman itself is released under the [MIT license](./LICENSE). The web and Android apps also ship the
components below, which keep their own licenses. Dependencies that are only used to build or test the
project are not listed.

## LibRaw

Jumpman decodes camera RAW files with [LibRaw](https://www.libraw.org) 0.22.1, compiled to WebAssembly
by the `libraw-wasm` package (next section). The decoder is the file `assets/libraw-*.wasm` in the app
build and is loaded at runtime only when a RAW file is imported.

```
LibRaw: Raw images processing library
Copyright (C) 2008-2025 LibRaw LLC (http://www.libraw.org, info@libraw.org)
```

LibRaw is free software, available under either of two licenses, at your choice:

1. GNU Lesser General Public License version 2.1
   ([LICENSE.LGPL](https://github.com/LibRaw/LibRaw/blob/0.22.1/LICENSE.LGPL))
2. Common Development and Distribution License version 1.0
   ([LICENSE.CDDL](https://github.com/LibRaw/LibRaw/blob/0.22.1/LICENSE.CDDL))

LibRaw includes code from dcraw (Dave Coffin), DCB and FBDD (Jacek Gozdz), the X3F library (Roland
Karlsson) and the Adobe DNG SDK. Their notices are listed in LibRaw's
[COPYRIGHT](https://github.com/LibRaw/LibRaw/blob/0.22.1/COPYRIGHT) file.

Source code: LibRaw at <https://github.com/LibRaw/LibRaw/tree/0.22.1>, and the WebAssembly build
scripts at <https://github.com/ybouane/LibRaw-Wasm>. Jumpman uses the unmodified build published as
`libraw-wasm@1.6.0`. To use a modified LibRaw, rebuild the package with its `compileLibraw.sh` and
replace the `.wasm` file (and its loader `worker-*.js`) in the app build.

## libraw-wasm

[libraw-wasm](https://github.com/ybouane/LibRaw-Wasm) 1.6.0, the JavaScript bindings and worker around
the LibRaw WebAssembly build, by ybouane and contributors. Licensed under the ISC license, as declared
in the package's `package.json`; the package ships no separate license file.

```
ISC License

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee
is hereby granted, provided that the above copyright notice and this permission notice appear in all
copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Little CMS

The LibRaw WebAssembly build links [Little CMS](https://www.littlecms.com) 2.19.1 for color
management.

```
MIT License

Copyright (c) 2023 Marti Maria Saguer

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the "Software"), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense,
and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial
portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## libjpeg (Independent JPEG Group)

The LibRaw WebAssembly build links the Independent JPEG Group's libjpeg 9f, used to decode lossy DNG
and Kodak JPEG raw files.

This software is based in part on the work of the Independent JPEG Group.

```
Copyright (C) 2024, Thomas G. Lane, Guido Vollbeding
```

libjpeg is free software under the IJG license, published with its source at
<https://www.ijg.org>.

## MediaPipe Tasks Vision

Subject masks run on the device with [MediaPipe](https://ai.google.dev/edge/mediapipe) Tasks Vision
1.2.2 (`@mediapipe/tasks-vision`), by Google LLC, licensed under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). Its WebAssembly runtime is the file
`assets/vision_wasm_module_internal-*.wasm` in the app build, with the loader
`assets/vision_wasm_module_internal-*.js`. Both load only when a subject mask is first used. The
package ships no separate license file; the license is declared in its `package.json`. Source code:
<https://github.com/google-ai-edge/mediapipe>.

## MagicTouch segmentation model

The subject mask model is MagicTouch v1 (`magic_touch.tflite`, float32), the interactive segmentation
model published by Google for MediaPipe at
<https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite>.
Its [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf) lists
photo editing among its intended uses and licenses the model under the
[Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0). Jumpman ships it unmodified as
`assets/magic_touch-*.tflite` (SHA-256
`e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25`).
