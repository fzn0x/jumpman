import {
  curvesTable,
  GRAIN_CELLS,
  HUE_BAND_CENTERS,
  HUE_BANDS,
  hueColor,
  type Layer,
  type Lut3D,
  type LutResolver,
  luma,
  type Mask,
  wbGains,
} from '@jumpman/core'
import { BASIC, CURVES, DISPLAY, GEOMETRY, HSL, LUT, SPLIT, VERTEX } from './shaders.ts'

type GL = WebGL2RenderingContext

export interface FrameGeometry {
  /** Crop window, normalized to the rotated image (0..1). Defaults to the full image. */
  rect?: { x: number; y: number; w: number; h: number }
  /** Quarter turns clockwise. */
  rotate?: number
  flipH?: boolean
}

export interface RenderOptions extends FrameGeometry {
  layers: Layer[]
  luts: LutResolver
  /** Output size in device pixels. */
  width: number
  height: number
  /** Salient center (normalized image coordinates) for subject masks. */
  subject?: { x: number; y: number }
  seed?: number
  /** Show the unedited photo. */
  showOriginal?: boolean
  /** 0..1 position of a before/after divider; 0 disables it. */
  split?: number
}

export interface Histogram {
  r: Uint32Array
  g: Uint32Array
  b: Uint32Array
  l: Uint32Array
  max: number
}

interface Target {
  fb: WebGLFramebuffer
  tex: WebGLTexture
  w: number
  h: number
}

/** Above this many pixels, intermediate targets fall back to 8-bit (4 targets × 8 B/px adds up). */
const FLOAT_TARGET_MAX_PIXELS = 12_000_000

const MASK_TYPES: Record<Mask['type'], number> = {
  linear: 1,
  radial: 2,
  luminance: 3,
  color: 4,
  sky: 5,
  subject: 6,
}

function bump(arr: Uint32Array, v: number) {
  const i = Math.floor(v)
  arr[i] = (arr[i] ?? 0) + 1
}

function compile(gl: GL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)
  if (!sh) throw new Error('Could not create shader')
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh)
    gl.deleteShader(sh)
    throw new Error(`Shader compile failed: ${log}`)
  }
  return sh
}

class Program {
  readonly program: WebGLProgram
  private locs = new Map<string, WebGLUniformLocation | null>()
  private gl: GL

  constructor(gl: GL, vs: string, fs: string) {
    this.gl = gl
    const p = gl.createProgram()
    if (!p) throw new Error('Could not create program')
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs))
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'a_pos')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`Program link failed: ${gl.getProgramInfoLog(p)}`)
    }
    this.program = p
  }

  use() {
    this.gl.useProgram(this.program)
    return this
  }

  loc(name: string) {
    if (!this.locs.has(name)) this.locs.set(name, this.gl.getUniformLocation(this.program, name))
    return this.locs.get(name) ?? null
  }

  f(name: string, v: number) {
    this.gl.uniform1f(this.loc(name), v)
    return this
  }
  i(name: string, v: number) {
    this.gl.uniform1i(this.loc(name), v)
    return this
  }
  u(name: string, v: number) {
    this.gl.uniform1ui(this.loc(name), v)
    return this
  }
  v2(name: string, x: number, y: number) {
    this.gl.uniform2f(this.loc(name), x, y)
    return this
  }
  v3(name: string, v: ArrayLike<number>) {
    this.gl.uniform3f(this.loc(name), v[0] ?? 0, v[1] ?? 0, v[2] ?? 0)
    return this
  }
  v4(name: string, x: number, y: number, z: number, w: number) {
    this.gl.uniform4f(this.loc(name), x, y, z, w)
    return this
  }
}

export interface RendererInfo {
  maxTextureSize: number
  floatTargets: boolean
}

/**
 * Renders a layer stack with WebGL2. One instance owns one canvas and keeps
 * the current photo and LUTs on the GPU between renders.
 */
export class GLRenderer {
  readonly gl: GL
  readonly info: RendererInfo
  private programs = new Map<string, Program>()
  private image: WebGLTexture | null = null
  private imageKey: string | null = null
  private imageSize = { w: 0, h: 0 }
  private lutTextures = new Map<Lut3D, WebGLTexture>()
  private curveTex: WebGLTexture | null = null
  private targets: Target[] = []
  private lastOutput: Target | null = null
  private quad: WebGLVertexArrayObject | null = null
  private lost = false

  static isSupported(): boolean {
    try {
      const c = document.createElement('canvas')
      return !!c.getContext('webgl2')
    } catch {
      return false
    }
  }

  readonly canvas: HTMLCanvasElement | OffscreenCanvas

  constructor(canvas: HTMLCanvasElement | OffscreenCanvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    }) as GL | null
    if (!gl) throw new Error('WebGL2 is not available')
    this.gl = gl
    const floatTargets = !!gl.getExtension('EXT_color_buffer_float')
    gl.getExtension('OES_texture_float_linear')
    this.info = { maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, floatTargets }
    if ('addEventListener' in canvas) {
      canvas.addEventListener('webglcontextlost', (e) => {
        e.preventDefault()
        this.lost = true
      })
      canvas.addEventListener('webglcontextrestored', () => this.reset())
    }
    this.reset()
  }

  get isLost(): boolean {
    return this.lost || this.gl.isContextLost()
  }

  private reset() {
    const gl = this.gl
    this.lost = false
    this.programs.clear()
    this.lutTextures = new Map()
    this.targets = []
    this.image = null
    this.imageKey = null
    this.curveTex = null
    this.quad = gl.createVertexArray()
    gl.bindVertexArray(this.quad)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  }

  private program(name: string, fs: string): Program {
    let p = this.programs.get(name)
    if (!p) {
      p = new Program(this.gl, VERTEX, fs)
      this.programs.set(name, p)
    }
    return p.use()
  }

  /** Uploads the photo (skipped when `key` matches the current one). */
  setImage(source: TexImageSource, key?: string): void {
    if (key && key === this.imageKey && this.image) return
    const gl = this.gl
    if (this.image) gl.deleteTexture(this.image)
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.image = tex
    this.imageKey = key ?? null
    const s = source as {
      width?: number
      height?: number
      videoWidth?: number
      naturalWidth?: number
      naturalHeight?: number
    }
    this.imageSize = { w: s.naturalWidth ?? s.width ?? 0, h: s.naturalHeight ?? s.height ?? 0 }
  }

  get imageWidth() {
    return this.imageSize.w
  }
  get imageHeight() {
    return this.imageSize.h
  }

  private target(index: number, w: number, h: number, bytes = false): Target {
    const gl = this.gl
    const existing = this.targets[index]
    if (existing && existing.w === w && existing.h === h) return existing
    if (existing) {
      gl.deleteFramebuffer(existing.fb)
      gl.deleteTexture(existing.tex)
    }
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, tex)
    // Half-float targets give smoother gradients; very large exports use 8-bit to save GPU memory.
    const float = this.info.floatTargets && !bytes && w * h <= FLOAT_TARGET_MAX_PIXELS
    const internal = float ? gl.RGBA16F : gl.RGBA8
    const type = float ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, gl.RGBA, type, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fb = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    const t = { fb: fb as WebGLFramebuffer, tex: tex as WebGLTexture, w, h }
    this.targets[index] = t
    return t
  }

  private lutTexture(lut: Lut3D): WebGLTexture {
    const hit = this.lutTextures.get(lut)
    if (hit) return hit
    const gl = this.gl
    const tex = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_3D, tex)
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1)
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGB16F,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGB,
      gl.FLOAT,
      lut.data,
    )
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) {
      gl.texParameteri(gl.TEXTURE_3D, p, gl.CLAMP_TO_EDGE)
    }
    this.lutTextures.set(lut, tex as WebGLTexture)
    return tex as WebGLTexture
  }

  private curveTexture(table: Float32Array): WebGLTexture {
    const gl = this.gl
    if (!this.curveTex) {
      this.curveTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, table.length / 4, 1, 0, gl.RGBA, gl.FLOAT, table)
    return this.curveTex as WebGLTexture
  }

  private draw(target: Target | null, w: number, h: number) {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null)
    gl.viewport(0, 0, w, h)
    gl.bindVertexArray(this.quad)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  private bindTexture(unit: number, tex: WebGLTexture, kind: number = this.gl.TEXTURE_2D) {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(kind, tex)
  }

  private setCommon(
    p: Program,
    layer: Layer,
    ctx: {
      rect: [number, number, number, number]
      imgAspect: number
      frameAspect: number
      subject: { x: number; y: number }
    },
  ) {
    p.i('u_src', 0)
      .v4('u_uvRect', ...ctx.rect)
      .f('u_imgAspect', ctx.imgAspect)
      .f('u_frameAspect', ctx.frameAspect)
      .f('u_opacity', layer.opacity)
      .v2('u_subject', ctx.subject.x, ctx.subject.y)
    const m = layer.mask
    if (!m) {
      p.i('u_maskType', 0)
      return
    }
    p.i('u_maskType', MASK_TYPES[m.type]).i('u_maskInvert', m.invert ? 1 : 0)
    switch (m.type) {
      case 'linear':
        p.v4('u_maskA', m.x0, m.y0, m.x1, m.y1)
        break
      case 'radial':
        p.v4('u_maskA', m.cx, m.cy, m.rx, m.ry).v4('u_maskB', m.feather, 0, 0, 0)
        break
      case 'luminance':
        p.v4('u_maskA', m.min, m.max, m.feather, 0)
        break
      case 'color':
        p.v4('u_maskA', m.hue, m.range, m.feather, 0)
        break
      case 'subject':
        p.v4('u_maskA', m.size, 0, 0, 0)
        break
      case 'sky':
        break
    }
  }

  /** Renders to the canvas (resized to the output size). Returns false if the context is lost. */
  render(opts: RenderOptions): boolean {
    if (this.isLost || !this.image) return false
    const w = Math.max(1, Math.round(opts.width))
    const h = Math.max(1, Math.round(opts.height))
    if (this.canvas.width !== w) this.canvas.width = w
    if (this.canvas.height !== h) this.canvas.height = h
    const r = opts.rect ?? { x: 0, y: 0, w: 1, h: 1 }
    const rect: [number, number, number, number] = [r.x, r.y, r.w, r.h]
    const rotate = (((opts.rotate ?? 0) % 4) + 4) % 4
    const iw = rotate % 2 ? this.imageSize.h : this.imageSize.w
    const ih = rotate % 2 ? this.imageSize.w : this.imageSize.h
    const ctx = {
      rect,
      imgAspect: iw / Math.max(1, ih),
      frameAspect: w / h,
      subject: opts.subject ?? { x: 0.5, y: 0.5 },
    }

    // Pass 0: geometry into the "original" target.
    const original = this.target(0, w, h)
    this.program('geometry', GEOMETRY)
      .i('u_image', 0)
      .v4('u_uvRect', ...rect)
      .i('u_rotate', rotate)
      .i('u_flip', opts.flipH ? 1 : 0)
    this.bindTexture(0, this.image)
    this.draw(original, w, h)

    let current = original
    let ping = 1
    for (const layer of opts.layers) {
      if (!layer.enabled || layer.opacity <= 0) continue
      const out = this.target(ping, w, h)
      if (!this.drawLayer(layer, current, out, ctx, opts)) continue
      current = out
      ping = ping === 1 ? 2 : 1
    }
    this.lastOutput = current

    this.program('display', DISPLAY)
      .i('u_edited', 0)
      .i('u_original', 1)
      .f('u_split', opts.split ?? 0)
      .i('u_showOriginal', opts.showOriginal ? 1 : 0)
    this.bindTexture(0, current.tex)
    this.bindTexture(1, original.tex)
    this.draw(null, w, h)
    return true
  }

  private drawLayer(
    layer: Layer,
    input: Target,
    out: Target,
    ctx: Parameters<GLRenderer['setCommon']>[2],
    opts: RenderOptions,
  ): boolean {
    let p: Program
    switch (layer.kind) {
      case 'basic': {
        const b = layer.params
        p = this.program('basic', BASIC)
        p.f('u_exposure', b.exposure)
          .f('u_brightness', b.brightness)
          .f('u_contrast', b.contrast)
          .f('u_highlights', b.highlights)
          .f('u_shadows', b.shadows)
          .f('u_whites', b.whites)
          .f('u_blacks', b.blacks)
          .v3('u_wb', wbGains(b.temperature, b.tint))
          .f('u_vibrance', b.vibrance)
          .f('u_saturation', b.saturation)
          .f('u_fade', b.fade)
          .f('u_vignette', b.vignette)
          .f('u_grain', b.grain)
          .u('u_seed', opts.seed ?? 7)
          .f('u_grainCells', GRAIN_CELLS)
        break
      }
      case 'curves': {
        p = this.program('curves', CURVES)
        this.bindTexture(1, this.curveTexture(curvesTable(layer.params)))
        p.i('u_curve', 1)
        break
      }
      case 'hsl': {
        p = this.program('hsl', HSL)
        const centers = HUE_BANDS.map((b) => HUE_BAND_CENTERS[b])
        const shift = HUE_BANDS.flatMap((b) => [
          layer.params[b].hue,
          layer.params[b].saturation,
          layer.params[b].luminance,
        ])
        this.gl.uniform1fv(p.loc('u_centers'), centers)
        this.gl.uniform3fv(p.loc('u_shift'), shift)
        break
      }
      case 'split': {
        p = this.program('split', SPLIT)
        const s = layer.params
        const sc = hueColor(s.shadowHue)
        const hc = hueColor(s.highlightHue)
        const sl = luma(sc)
        const hl = luma(hc)
        p.v3(
          'u_shadowTint',
          sc.map((v) => v - sl),
        )
          .v3(
            'u_highlightTint',
            hc.map((v) => v - hl),
          )
          .f('u_shadowSat', s.shadowSaturation / 100)
          .f('u_highlightSat', s.highlightSaturation / 100)
          .f('u_pivot', 0.5 - 0.3 * (s.balance / 100))
        break
      }
      case 'lut': {
        const lut = opts.luts(layer.params.lutId)
        if (!lut) return false
        p = this.program('lut', LUT)
        this.bindTexture(2, this.lutTexture(lut), this.gl.TEXTURE_3D)
        p.i('u_lut', 2).f('u_lutSize', lut.size)
        break
      }
    }
    this.setCommon(p, layer, ctx)
    this.bindTexture(0, input.tex)
    this.draw(out, out.w, out.h)
    return true
  }

  /** Reads the last rendered frame (edited, without the compare divider), top row first. */
  readPixels(): { width: number; height: number; data: Uint8ClampedArray } {
    const gl = this.gl
    const t = this.lastOutput
    if (!t || this.isLost) return { width: 0, height: 0, data: new Uint8ClampedArray() }
    // Copy through the display pass into an 8-bit target: half-float targets
    // can't be read back as bytes on every GPU.
    const readback = this.target(3, t.w, t.h, true)
    this.program('display', DISPLAY)
      .i('u_edited', 0)
      .i('u_original', 1)
      .f('u_split', 0)
      .i('u_showOriginal', 0)
    this.bindTexture(0, t.tex)
    this.bindTexture(1, t.tex)
    this.draw(readback, t.w, t.h)
    const raw = new Uint8Array(t.w * t.h * 4)
    gl.readPixels(0, 0, t.w, t.h, gl.RGBA, gl.UNSIGNED_BYTE, raw)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    const out = new Uint8ClampedArray(raw.length)
    const row = t.w * 4
    for (let y = 0; y < t.h; y++)
      out.set(raw.subarray((t.h - 1 - y) * row, (t.h - y) * row), y * row)
    return { width: t.w, height: t.h, data: out }
  }

  /** Histogram of the last rendered frame (sampled for speed). */
  histogram(bins = 64): Histogram {
    const { data } = this.readPixels()
    const r = new Uint32Array(bins)
    const g = new Uint32Array(bins)
    const b = new Uint32Array(bins)
    const l = new Uint32Array(bins)
    const step = Math.max(1, Math.floor(data.length / 4 / 60_000)) * 4
    const k = bins / 256
    for (let i = 0; i < data.length; i += step) {
      const R = data[i] as number
      const G = data[i + 1] as number
      const B = data[i + 2] as number
      bump(r, R * k)
      bump(g, G * k)
      bump(b, B * k)
      bump(l, (0.2126 * R + 0.7152 * G + 0.0722 * B) * k)
    }
    let max = 1
    for (const arr of [r, g, b]) for (const v of arr) if (v > max) max = v
    return { r, g, b, l, max }
  }

  /** Frees GPU resources. Pass false to keep the canvas usable (e.g. React remounts). */
  dispose(loseContext = true): void {
    const gl = this.gl
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fb)
      gl.deleteTexture(t.tex)
    }
    for (const t of this.lutTextures.values()) gl.deleteTexture(t)
    if (this.image) gl.deleteTexture(this.image)
    if (this.curveTex) gl.deleteTexture(this.curveTex)
    this.targets = []
    this.lutTextures.clear()
    this.image = null
    this.imageKey = null
    this.curveTex = null
    this.programs.clear()
    if (loseContext) gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
