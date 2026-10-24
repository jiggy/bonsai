import type { Timing, TimingStage } from './model.ts'

const copyStage = (stage: TimingStage): TimingStage => ({
  ...stage,
  ...(stage.stages ? { stages: stage.stages.map(copyStage) } : {}),
})

/** Monotonic phase measurements stay available while work is running or interrupted. */
export class Timer {
  private stages: TimingStage[] = []
  private active?: { name: string; started: number; child?: Pick<Timer, 'report'> }
  private began = false

  constructor(private readonly started = performance.now()) {}

  start(name: string, child?: Pick<Timer, 'report'>): void {
    this.finish()
    this.active = { name, started: this.began ? performance.now() : this.started, child }
    this.began = true
  }

  finish(status: 'completed' | 'interrupted' = 'completed'): void {
    if (!this.active) return
    this.stages.push({
      name: this.active.name,
      elapsedMs: performance.now() - this.active.started,
      status,
      ...(this.active.child
        ? { stages: this.active.child.report(status === 'interrupted').stages }
        : {}),
    })
    this.active = undefined
  }

  /** Keep worker phases at the same level and account for its unmeasured overhead. */
  finishWith(stages: TimingStage[]): void {
    if (!this.active) return
    const elapsedMs = performance.now() - this.active.started
    this.stages.push(...stages.map(copyStage), {
      name: this.active.name,
      elapsedMs: Math.max(
        0,
        elapsedMs - stages.reduce((sum, stage) => sum + (stage.elapsedMs ?? 0), 0),
      ),
      status: 'completed',
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
        ...this.stages.map(copyStage),
        ...(this.active
          ? [
              {
                name: this.active.name,
                elapsedMs: now - this.active.started,
                status: interrupted ? ('interrupted' as const) : ('running' as const),
                ...(this.active.child
                  ? { stages: this.active.child.report(interrupted).stages }
                  : {}),
              },
            ]
          : []),
      ],
    }
  }
}
