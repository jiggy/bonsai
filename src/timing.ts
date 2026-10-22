import type { Timing, TimingStage } from './model.ts'

/** Monotonic phase measurements stay available while work is running or interrupted. */
export class Timer {
  private stages: TimingStage[] = []
  private active?: { name: string; started: number }
  private began = false

  constructor(private readonly started = performance.now()) {}

  start(name: string): void {
    this.finish()
    this.active = { name, started: this.began ? performance.now() : this.started }
    this.began = true
  }

  finish(status: 'completed' | 'interrupted' = 'completed'): void {
    if (!this.active) return
    this.stages.push({
      name: this.active.name,
      elapsedMs: performance.now() - this.active.started,
      status,
    })
    this.active = undefined
  }

  skip(name: string): void {
    this.finish()
    this.began = true
    this.stages.push({ name, elapsedMs: null, status: 'skipped' })
  }

  report(interrupted = false): Timing {
    const now = performance.now()
    return {
      elapsedMs: now - this.started,
      stages: [
        ...this.stages.map((stage) => ({ ...stage })),
        ...(this.active
          ? [
              {
                name: this.active.name,
                elapsedMs: now - this.active.started,
                status: interrupted ? ('interrupted' as const) : ('running' as const),
              },
            ]
          : []),
      ],
    }
  }
}
