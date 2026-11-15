/**
 * Landing page motion: scroll reveals, count-ups and the small looping demos.
 *
 * Markup always holds the finished state, so the page reads the same with JavaScript off or
 * with reduced motion. Demos only rewind to their start state once they are on screen, run one
 * gentle loop while at least 40% visible, and settle back to the finished state when they leave.
 */

declare global {
  interface Window {
    __jmMotion?: boolean
  }
}

window.__jmMotion = true

const root = document.documentElement
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches

class Stop extends Error {}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Stop())
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new Stop())
      },
      { once: true },
    )
  })
}

const easeOut = (p: number) => 1 - (1 - p) ** 3

/** Counts `el`'s text from `from` to `to`, formatted by `format`. */
function tween(
  el: Element,
  from: number,
  to: number,
  ms: number,
  format: (v: number) => string,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now()
    const frame = (t: number) => {
      if (signal.aborted) return reject(new Stop())
      const p = Math.min((t - t0) / ms, 1)
      el.textContent = format(from + (to - from) * easeOut(p))
      if (p < 1) requestAnimationFrame(frame)
      else resolve()
    }
    requestAnimationFrame(frame)
  })
}

/** Applies a state change with transitions switched off, so it lands instantly. */
function snap(el: HTMLElement, change: () => void) {
  el.classList.add('snap')
  change()
  void el.offsetWidth
  el.classList.remove('snap')
}

function $(el: ParentNode, selector: string): HTMLElement {
  const found = el.querySelector<HTMLElement>(selector)
  if (!found) throw new Error(`Missing ${selector}`)
  return found
}

/* Reveals ---------------------------------------------------------------- */

function initReveals() {
  if (!root.classList.contains('motion')) return
  const io = new IntersectionObserver(
    (entries) => {
      // Elements that come into view together are staggered; later ones start at once.
      let k = 0
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target as HTMLElement
        io.unobserve(el)
        el.style.setProperty('--i', String(Math.min(k++, 6)))
        el.classList.add('is-in')
        // Once it has arrived, drop the reveal styles so the element's own transitions
        // (hover lifts and the like) are back in charge.
        const done = () => {
          el.removeAttribute('data-reveal')
          el.classList.remove('is-in')
          el.style.removeProperty('--i')
        }
        el.addEventListener(
          'transitionend',
          (e) => e.target === el && e.propertyName === 'transform' && done(),
        )
        setTimeout(done, 2500)
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
  )
  for (const el of document.querySelectorAll('[data-reveal]')) io.observe(el)
}

/* Count-ups -------------------------------------------------------------- */

function initCounts() {
  if (reduce) return
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const el = entry.target as HTMLElement
        io.unobserve(el)
        const to = Number(el.dataset.countTo)
        const delay = Number(el.dataset.countDelay ?? 0)
        el.textContent = '0'
        const run = new AbortController()
        sleep(delay, run.signal)
          .then(() => tween(el, 0, to, 1400, (v) => String(Math.round(v)), run.signal))
          .catch(() => {
            el.textContent = String(to)
          })
      }
    },
    { threshold: 0.5 },
  )
  for (const el of document.querySelectorAll('[data-count-to]')) io.observe(el)
}

/* Demos ------------------------------------------------------------------ */

interface Demo {
  /** Rewinds to the start state (called with transitions off). */
  rewind(el: HTMLElement): void
  /** Plays start to finish, holds, then eases back to the start state. */
  play(el: HTMLElement, signal: AbortSignal): Promise<void>
  /** Puts the finished state back (called with transitions off). */
  settle(el: HTMLElement): void
}

const fmtSigned = (v: number) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}`
const fmtMb = (v: number) => `${v.toFixed(1)} MB`

/** One slider moves the whole set: thumbnails take the look as the dial turns. */
const globalEdit: Demo = {
  rewind(el) {
    el.dataset.step = '0'
    $(el, '[data-val]').textContent = fmtSigned(0)
  },
  async play(el, signal) {
    const val = $(el, '[data-val]')
    const to = Number(val.dataset.val)
    await sleep(500, signal)
    delete el.dataset.step
    await tween(val, 0, to, 1700, fmtSigned, signal)
    await sleep(3000, signal)
    el.dataset.step = '0'
    await tween(val, to, 0, 700, fmtSigned, signal)
    await sleep(700, signal)
  },
  settle(el) {
    delete el.dataset.step
    const val = $(el, '[data-val]')
    val.textContent = fmtSigned(Number(val.dataset.val))
  },
}

/** Smart selection cycles through its modes; each picks a different subset. */
const selection: Demo = {
  rewind(el) {
    el.dataset.mode = '0'
    this.settle(el)
  },
  async play(el, signal) {
    const modes = Number(el.dataset.modes ?? 4)
    for (let m = 1; m <= modes; m++) {
      await sleep(2600, signal)
      el.dataset.mode = String(m % modes)
      this.settle(el)
    }
  },
  settle(el) {
    const mode = el.dataset.mode ?? '0'
    const picked = el.querySelectorAll(`[data-in~="${mode}"]`).length
    $(el, '[data-picked]').textContent = String(picked)
    const label = el.querySelectorAll<HTMLElement>('[data-tab]')[Number(mode)]
    $(el, '[data-mode-label]').textContent = label?.dataset.tab ?? ''
  },
}

/** The consistency score climbs as Harmonize evens out the set. */
const score: Demo = {
  rewind(el) {
    el.dataset.step = '0'
    const num = $(el, '[data-score]')
    num.textContent = num.dataset.from ?? '0'
  },
  async play(el, signal) {
    const num = $(el, '[data-score]')
    const from = Number(num.dataset.from)
    const to = Number(num.dataset.score)
    await sleep(900, signal)
    el.classList.add('press')
    await sleep(180, signal)
    el.classList.remove('press')
    delete el.dataset.step
    await tween(num, from, to, 1500, (v) => String(Math.round(v)), signal)
    await sleep(3200, signal)
    el.dataset.step = '0'
    await tween(num, to, from, 600, (v) => String(Math.round(v)), signal)
    await sleep(600, signal)
  },
  settle(el) {
    el.classList.remove('press')
    delete el.dataset.step
    const num = $(el, '[data-score]')
    num.textContent = num.dataset.score ?? ''
  },
}

/** Bulk crop steps through aspect ratios; every frame follows. */
const crop: Demo = {
  rewind(el) {
    el.dataset.ratio = '0'
  },
  async play(el, signal) {
    const n = Number(el.dataset.ratios ?? 3)
    for (let r = 1; r <= n; r++) {
      await sleep(2400, signal)
      el.dataset.ratio = String(r % n)
    }
  },
  settle(el) {
    el.dataset.ratio = el.dataset.final ?? '0'
  },
}

/** Batch export: files land one by one while the total counts up. */
const exporter: Demo = {
  rewind(el) {
    el.dataset.step = '0'
    $(el, '[data-total]').textContent = fmtMb(0)
  },
  async play(el, signal) {
    const total = $(el, '[data-total]')
    const to = Number(total.dataset.total)
    const files = el.querySelectorAll('[data-file]').length
    await sleep(600, signal)
    el.dataset.step = '1'
    await tween(total, 0, to, files * 260 + 300, fmtMb, signal)
    delete el.dataset.step
    await sleep(3200, signal)
    el.dataset.step = '0'
    total.textContent = fmtMb(0)
    await sleep(900, signal)
  },
  settle(el) {
    delete el.dataset.step
    const total = $(el, '[data-total]')
    total.textContent = fmtMb(Number(total.dataset.total))
  },
}

/** Edit by description: the prompt types itself, then the parsed moves appear. */
const describe: Demo = {
  rewind(el) {
    el.dataset.step = '0'
    $(el, '[data-typed]').textContent = ''
  },
  async play(el, signal) {
    const typed = $(el, '[data-typed]')
    const text = typed.dataset.typed ?? ''
    await sleep(500, signal)
    for (let i = 1; i <= text.length; i++) {
      typed.textContent = text.slice(0, i)
      await sleep(text[i - 1] === ',' ? 260 : 45, signal)
    }
    await sleep(250, signal)
    delete el.dataset.step
    await sleep(4200, signal)
    el.dataset.step = '0'
    await sleep(500, signal)
    for (let i = text.length - 1; i >= 0; i -= 2) {
      typed.textContent = text.slice(0, i)
      await sleep(14, signal)
    }
    typed.textContent = ''
    await sleep(500, signal)
  },
  settle(el) {
    delete el.dataset.step
    const typed = $(el, '[data-typed]')
    typed.textContent = typed.dataset.typed ?? ''
  },
}

/** Reference-match: five mismatched photos fall into line with the hero shot. */
const match: Demo = {
  rewind(el) {
    el.dataset.step = '0'
  },
  async play(el, signal) {
    await sleep(800, signal)
    delete el.dataset.step
    await sleep(4200, signal)
    el.dataset.step = '0'
    await sleep(1200, signal)
  },
  settle(el) {
    delete el.dataset.step
  },
}

const DEMOS: Record<string, Demo> = {
  global: globalEdit,
  selection,
  score,
  crop,
  export: exporter,
  describe,
  match,
}

function initDemos() {
  if (reduce) return
  for (const el of document.querySelectorAll<HTMLElement>('[data-demo]')) {
    const demo = DEMOS[el.dataset.demo ?? '']
    if (!demo) continue
    let run: AbortController | null = null
    const start = () => {
      if (run) return
      const ctrl = new AbortController()
      run = ctrl
      snap(el, () => demo.rewind(el))
      ;(async () => {
        // Cards that enter together start a beat apart, so the grid never moves in unison.
        await sleep(Number(el.dataset.offset ?? 0), ctrl.signal)
        for (;;) await demo.play(el, ctrl.signal)
      })().catch((err) => {
        if (!(err instanceof Stop)) throw err
      })
    }
    const stop = () => {
      if (!run) return
      run.abort()
      run = null
      snap(el, () => demo.settle(el))
    }
    new IntersectionObserver(([entry]) => (entry?.isIntersecting ? start() : stop()), {
      threshold: 0.4,
    }).observe(el)
  }
}

initReveals()
initCounts()
initDemos()
