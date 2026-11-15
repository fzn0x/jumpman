import { describe, expect, it } from 'vitest'
import { serialQueue } from './util.ts'

/** Lets every pending promise callback run. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

describe('serialQueue', () => {
  it('runs tasks one at a time in call order', async () => {
    const run = serialQueue()
    const log: string[] = []
    const gates: (() => void)[] = []
    const task = (name: string) => () => {
      log.push(`start ${name}`)
      return new Promise<string>((resolve) => {
        gates.push(() => {
          log.push(`end ${name}`)
          resolve(name)
        })
      })
    }
    const results = Promise.all([run(task('a')), run(task('b')), run(task('c'))])
    await settle()
    expect(log).toEqual(['start a'])
    gates.shift()?.()
    await settle()
    expect(log).toEqual(['start a', 'end a', 'start b'])
    gates.shift()?.()
    await settle()
    gates.shift()?.()
    expect(await results).toEqual(['a', 'b', 'c'])
    expect(log).toEqual(['start a', 'end a', 'start b', 'end b', 'start c', 'end c'])
  })

  it('keeps going after a task fails', async () => {
    const run = serialQueue()
    const failed = run(async () => {
      throw new Error('boom')
    })
    const next = run(async () => 'ok')
    await expect(failed).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ok')
  })

  it('gives each runner its own queue', async () => {
    const a = serialQueue()
    const b = serialQueue()
    let release: () => void = () => {}
    const blocked = a(() => new Promise<void>((r) => (release = r)))
    await expect(b(async () => 'free')).resolves.toBe('free')
    release()
    await blocked
  })
})
