/**
 * GLSL ES 3.00 sources. Every formula mirrors packages/core/src/color/pipeline.ts;
 * when changing one, change the other.
 */

export const VERTEX = /* glsl */ `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  // Frame coordinates with the origin at the top-left.
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`

const HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
in vec2 v_uv;
out vec4 outColor;
`

/** Shared helpers: color conversions and masks. */
const COMMON = /* glsl */ `
uniform sampler2D u_src;
uniform vec4 u_uvRect;
uniform float u_imgAspect;
uniform float u_frameAspect;
uniform float u_opacity;
uniform int u_maskType;
uniform vec4 u_maskA;
uniform vec4 u_maskB;
uniform int u_maskInvert;
uniform vec2 u_subject;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 readSrc() {
  // Intermediate textures are stored bottom-up.
  return texture(u_src, vec2(v_uv.x, 1.0 - v_uv.y)).rgb;
}

float srgbToLinear(float v) { return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4); }
float linearToSrgb(float v) { return v <= 0.0031308 ? v * 12.92 : 1.055 * pow(v, 1.0 / 2.4) - 0.055; }
vec3 srgbToLinear3(vec3 c) { return vec3(srgbToLinear(c.r), srgbToLinear(c.g), srgbToLinear(c.b)); }
vec3 linearToSrgb3(vec3 c) { return vec3(linearToSrgb(c.r), linearToSrgb(c.g), linearToSrgb(c.b)); }

vec3 rgbToHsl(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  if (d < 1e-7) return vec3(0.0, 0.0, l);
  float s = d / (1.0 - abs(2.0 * l - 1.0) + 1e-7);
  float h;
  if (mx == c.r) h = mod((c.g - c.b) / d, 6.0);
  else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
  else h = (c.r - c.g) / d + 4.0;
  h *= 60.0;
  if (h < 0.0) h += 360.0;
  return vec3(h, clamp(s, 0.0, 1.0), l);
}

vec3 hslToRgb(vec3 hsl) {
  float c = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y;
  float hp = mod(mod(hsl.x, 360.0) + 360.0, 360.0) / 60.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 rgb;
  if (hp < 1.0) rgb = vec3(c, x, 0.0);
  else if (hp < 2.0) rgb = vec3(x, c, 0.0);
  else if (hp < 3.0) rgb = vec3(0.0, c, x);
  else if (hp < 4.0) rgb = vec3(0.0, x, c);
  else if (hp < 5.0) rgb = vec3(x, 0.0, c);
  else rgb = vec3(c, 0.0, x);
  return rgb + (hsl.z - c * 0.5);
}

float hueDistance(float a, float b) {
  float d = abs(mod(mod(a - b, 360.0) + 360.0, 360.0));
  return d > 180.0 ? 360.0 - d : d;
}

float maskValue(vec3 rgb) {
  if (u_maskType == 0) return 1.0;
  vec2 p = u_uvRect.xy + v_uv * u_uvRect.zw;
  float m = 1.0;
  if (u_maskType == 1) {
    vec2 d = vec2((u_maskA.z - u_maskA.x) * u_imgAspect, u_maskA.w - u_maskA.y);
    float len2 = max(dot(d, d), 1e-6);
    float t = dot(vec2((p.x - u_maskA.x) * u_imgAspect, p.y - u_maskA.y), d) / len2;
    m = 1.0 - smoothstep(0.0, 1.0, t);
  } else if (u_maskType == 2) {
    vec2 q = (p - u_maskA.xy) / max(u_maskA.zw, vec2(1e-4));
    m = 1.0 - smoothstep(1.0 - max(u_maskB.x, 0.001), 1.0, length(q));
  } else if (u_maskType == 3) {
    float l = dot(rgb, LUMA);
    float f = max(u_maskA.z, 0.001);
    m = smoothstep(u_maskA.x - f, u_maskA.x, l) * (1.0 - smoothstep(u_maskA.y, u_maskA.y + f, l));
  } else if (u_maskType == 4) {
    vec3 hsl = rgbToHsl(rgb);
    float fd = 10.0 + u_maskA.z * 60.0;
    m = (1.0 - smoothstep(u_maskA.y, u_maskA.y + fd, hueDistance(hsl.x, u_maskA.x))) * smoothstep(0.08, 0.2, hsl.y);
  } else if (u_maskType == 5) {
    vec3 hsl = rgbToHsl(rgb);
    float vertical = 1.0 - smoothstep(0.3, 0.7, p.y);
    float blue = (1.0 - smoothstep(30.0, 60.0, hueDistance(hsl.x, 215.0))) * smoothstep(0.1, 0.25, hsl.y);
    float overcast = smoothstep(0.65, 0.85, hsl.z) * (1.0 - smoothstep(0.15, 0.35, hsl.y));
    m = vertical * max(blue, overcast);
  } else if (u_maskType == 6) {
    float r = max(u_maskA.x, 0.05) * 0.5;
    vec2 q = vec2((p.x - u_subject.x) * u_imgAspect, p.y - u_subject.y) / r;
    m = 1.0 - smoothstep(0.5, 1.0, length(q));
  }
  return u_maskInvert == 1 ? 1.0 - m : m;
}

void emit(vec3 inC, vec3 outC) {
  float k = u_opacity * maskValue(inC);
  outColor = vec4(mix(inC, clamp(outC, 0.0, 1.0), clamp(k, 0.0, 1.0)), 1.0);
}
`

/** Copies the source photo into the frame: crop, quarter-turn rotation and flip. */
export const GEOMETRY = `${HEADER}
uniform sampler2D u_image;
uniform vec4 u_uvRect;
uniform int u_rotate;
uniform int u_flip;
void main() {
  vec2 p = u_uvRect.xy + v_uv * u_uvRect.zw;
  if (u_flip == 1) p.x = 1.0 - p.x;
  vec2 s;
  if (u_rotate == 1) s = vec2(p.y, 1.0 - p.x);
  else if (u_rotate == 2) s = vec2(1.0 - p.x, 1.0 - p.y);
  else if (u_rotate == 3) s = vec2(1.0 - p.y, p.x);
  else s = p;
  outColor = vec4(texture(u_image, s).rgb, 1.0);
}
`

export const BASIC = `${HEADER}${COMMON}
uniform float u_exposure;
uniform float u_brightness;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;
uniform vec3 u_wb;
uniform float u_vibrance;
uniform float u_saturation;
uniform float u_fade;
uniform float u_vignette;
uniform float u_grain;
uniform uint u_seed;
uniform float u_grainCells;

const float PIVOT = 0.46;

float toneCurve(float L0) {
  float h = u_highlights / 100.0;
  float s = u_shadows / 100.0;
  float w = u_whites / 100.0;
  float b = u_blacks / 100.0;
  float c = u_contrast / 100.0;
  float br = u_brightness / 100.0;
  float L = L0;
  L += w * 0.3 * L * L;
  float t = clamp(L, 0.0, 1.0);
  L += h * 0.25 * 6.75 * t * t * (1.0 - t);
  if (h < 0.0) L += h * 0.6 * max(L - 0.85, 0.0);
  t = clamp(L, 0.0, 1.0);
  L += s * 0.25 * 6.75 * t * (1.0 - t) * (1.0 - t);
  t = clamp(L, 0.0, 1.0);
  L += b * 0.12 * pow(1.0 - t, 3.0);
  L = clamp(L, 0.0, 1.0);
  if (c != 0.0) {
    float k = exp(c * 0.9);
    L = L < PIVOT ? PIVOT * pow(L / PIVOT, k) : 1.0 - (1.0 - PIVOT) * pow((1.0 - L) / (1.0 - PIVOT), k);
  }
  if (br != 0.0) L = pow(L, exp(-br * 0.6));
  return L;
}

uint hash32(uint x) {
  x ^= x >> 16u;
  x *= 0x7feb352du;
  x ^= x >> 15u;
  x *= 0x846ca68bu;
  x ^= x >> 16u;
  return x;
}

float cellNoise(int ix, int iy) {
  uint inner = hash32(uint(iy) * 9277u + u_seed);
  return float(hash32(uint(ix) * 1973u + inner)) / 4294967295.0;
}

float grainNoise(vec2 uv) {
  float sx = u_frameAspect >= 1.0 ? 1.0 : u_frameAspect;
  float sy = u_frameAspect >= 1.0 ? 1.0 / u_frameAspect : 1.0;
  vec2 q = vec2(uv.x * sx, uv.y * sy) * u_grainCells;
  vec2 i = floor(q);
  vec2 f = q - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  int ix = int(i.x);
  int iy = int(i.y);
  float a = cellNoise(ix, iy);
  float b = cellNoise(ix + 1, iy);
  float c = cellNoise(ix, iy + 1);
  float d = cellNoise(ix + 1, iy + 1);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}

void main() {
  vec3 src = readSrc();
  vec3 lin = srgbToLinear3(src) * u_wb * exp2(u_exposure);
  float Y = dot(lin, LUMA);
  float L = linearToSrgb(max(Y, 0.0));
  float Y2 = srgbToLinear(toneCurve(L));
  lin = Y > 1e-6 ? lin * (Y2 / Y) : vec3(Y2);
  vec3 d = clamp(linearToSrgb3(max(lin, vec3(0.0))), 0.0, 1.0);

  if (u_saturation != 0.0 || u_vibrance != 0.0) {
    float l = dot(d, LUMA);
    float s = max(d.r, max(d.g, d.b)) - min(d.r, min(d.g, d.b));
    float f = max(0.0, 1.0 + u_saturation / 100.0 + (u_vibrance / 100.0) * (1.0 - s));
    d = l + (d - l) * f;
  }
  if (u_fade != 0.0) {
    float f = u_fade / 100.0;
    d = d * (1.0 - 0.18 * f) + vec3(0.1, 0.1, 0.09) * f;
  }
  if (u_vignette != 0.0) {
    float v = u_vignette / 100.0;
    vec2 dd = vec2((v_uv.x - 0.5) * u_frameAspect, v_uv.y - 0.5);
    float dist = length(dd) / sqrt(0.25 * u_frameAspect * u_frameAspect + 0.25);
    float w = smoothstep(0.35, 1.0, dist);
    if (v < 0.0) d *= 1.0 + v * 0.8 * w;
    else d += (1.0 - d) * v * 0.6 * w;
  }
  if (u_grain != 0.0) {
    float l = dot(d, LUMA);
    float n = (grainNoise(v_uv) - 0.5) * (u_grain / 100.0) * 0.16;
    d += n * (1.0 - abs(l - 0.5));
  }
  emit(src, d);
}
`

export const CURVES = `${HEADER}${COMMON}
uniform sampler2D u_curve;
float lookup(float v, int ch) {
  // 256-entry table sampled at texel centers.
  float x = clamp(v, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
  return texture(u_curve, vec2(x, 0.5))[ch];
}
void main() {
  vec3 src = readSrc();
  emit(src, vec3(lookup(src.r, 0), lookup(src.g, 1), lookup(src.b, 2)));
}
`

export const HSL = `${HEADER}${COMMON}
uniform float u_centers[8];
uniform vec3 u_shift[8];
void main() {
  vec3 src = readSrc();
  vec3 hsl = rgbToHsl(src);
  float gate = smoothstep(0.0, 0.25, hsl.y);
  vec3 acc = vec3(0.0);
  float h = mod(mod(hsl.x, 360.0) + 360.0, 360.0);
  for (int i = 0; i < 8; i++) {
    float a = u_centers[i];
    float next = i + 1 < 8 ? u_centers[i + 1] : 360.0;
    if (h >= a && h < next) {
      float t = smoothstep(0.0, 1.0, (h - a) / (next - a));
      acc += u_shift[i] * (1.0 - t);
      acc += u_shift[(i + 1) % 8] * t;
    }
  }
  if (gate <= 0.0 || acc == vec3(0.0)) {
    emit(src, src);
    return;
  }
  vec3 rgb = hslToRgb(vec3(hsl.x + (acc.x / 100.0) * 30.0 * gate, clamp(hsl.y * (1.0 + (acc.y / 100.0) * gate), 0.0, 1.0), hsl.z));
  emit(src, rgb * (1.0 + (acc.z / 100.0) * 0.6 * gate));
}
`

export const SPLIT = `${HEADER}${COMMON}
uniform vec3 u_shadowTint;
uniform vec3 u_highlightTint;
uniform float u_shadowSat;
uniform float u_highlightSat;
uniform float u_pivot;
void main() {
  vec3 src = readSrc();
  float l = dot(src, LUMA);
  float ws = 1.0 - smoothstep(u_pivot - 0.35, u_pivot + 0.15, l);
  float wh = smoothstep(u_pivot - 0.15, u_pivot + 0.35, l);
  vec3 outC = src + u_shadowTint * (u_shadowSat * ws * 0.35) + u_highlightTint * (u_highlightSat * wh * 0.35);
  emit(src, outC);
}
`

export const LUT = `${HEADER}${COMMON}
precision highp sampler3D;
uniform sampler3D u_lut;
uniform float u_lutSize;
void main() {
  vec3 src = readSrc();
  vec3 coord = clamp(src, 0.0, 1.0) * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
  emit(src, texture(u_lut, coord).rgb);
}
`

/** Draws the final frame to the canvas, optionally split with the original. */
export const DISPLAY = `${HEADER}
uniform sampler2D u_edited;
uniform sampler2D u_original;
uniform float u_split;
uniform int u_showOriginal;
void main() {
  vec2 st = vec2(v_uv.x, 1.0 - v_uv.y);
  bool before = u_showOriginal == 1 || v_uv.x < u_split;
  vec3 c = before ? texture(u_original, st).rgb : texture(u_edited, st).rgb;
  if (u_split > 0.0 && u_split < 1.0 && abs(v_uv.x - u_split) < 0.0015) c = vec3(1.0);
  outColor = vec4(c, 1.0);
}
`
