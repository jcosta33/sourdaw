/**
 * Shared control-rate slew for device-parameter automation — the single source
 * of truth for the first-order exponential smoothing the live apply path
 * (#746) runs on every automated device/MIDI-FX parameter before it reaches the
 * DSP, and that the offline compile path replicates so a bounce matches what you
 * monitor (finding AU-2, AUDIT-automation.md).
 *
 * ## The filter (state the math)
 *
 * Live `applyAutomation` runs, once per scheduler tick, a first-order IIR
 * one-pole low-pass on the target curve value:
 *
 *     y[n] = y[n-1] + α · (x[n] − y[n-1])          (equivalently
 *          = (1 − α) · y[n-1] + α · x[n])           α = {@link AUTOMATION_SLEW_ALPHA})
 *
 * seeded `y[0] = x[0]` (the first tick reads `prev ?? value`, so `smoothed =
 * value`). `x[n]` is the true curve value sampled at the tick grid; `y[n]` is
 * the value actually written to the parameter.
 *
 * **The tick grid is the transport scheduler grain, and that grain is settable.**
 * `applyAutomation` runs exactly one {@link slewStep} per scheduler tick, and
 * `startPlayheadScheduler` ticks every `transportStore.value.scheduleGrainMs`
 * (default 10 ms, i.e. 100 Hz). `Δt` is therefore *state*, not a constant, and
 * the offline replica has to read the same state — see
 * {@link automationSlewTickSecondsForGrain}. The offline path used to hardcode
 * 10 ms, so at any other grain the bounce's slew filter stopped matching the
 * monitor's and automation ramps rendered differently from what was heard.
 *
 * At the shipping default: pole `(1 − α) = 0.6`; per-tick time constant
 * `τ = −Δt / ln(1 − α) = −0.01 / ln 0.6 ≈ 19.6 ms`; −3 dB corner
 * `≈ 1 / (2π τ) ≈ 8.1 Hz`. This is a genuine low-pass: fast automation moves are
 * rounded off and lag the target by ~τ, exactly the "monitor low-passes, bounce
 * does not" divergence AU-2 names.
 *
 * The offline path replicates it by sampling the compiled curve `x(t)` on the
 * same `Δt` grid and running the identical recurrence via {@link slewStep}. The
 * compiled events carry the true curve at ≤`Δt` resolution — the offline event
 * compiler (`AudioEngine/repositories/offlineScheduler/`) tightens its curve
 * pre-sampling interval to the slew tick for exactly this reason — so resampling
 * them on the `Δt` grid recovers the same `x[n]` the live path sees.
 *
 * **The remaining gap is the tick grid itself, and it is not closable here.**
 * Offline assumes a rigid `n·Δt` grid. Live is not rigid: `startPlayheadScheduler`
 * drops a tick outright when async work — the Yeast Worker round-trip in
 * particular — outruns one grain, and the following tick advances by the real,
 * larger delta while still applying exactly **one** `slewStep`. Under that load
 * the monitor therefore applies *fewer* filter steps per unit real time than the
 * bounce does, and its ramp settles slower. The divergence is load-dependent,
 * grows as the grain gets finer, and cannot be fixed by threading a scalar tick
 * period through — closing it needs the render to replay the tick schedule the
 * live pass actually produced, which nothing records today.
 *
 * So: identical for a session that never drops a tick, which is the common case,
 * and a bounded approximation otherwise. Do not restate this as "sample-for-sample
 * identical" — an earlier revision of this comment did, and it is not true under
 * load.
 *
 * Gain/pan are deliberately **not** slewed here (nor live): they are backed by
 * real `AudioParam`s smoothed in-engine (`setTargetAtTime`) / scheduled a-rate,
 * so both live and offline bypass this filter for them (AU-2).
 *
 * RT-safe: pure, allocation-free, no locks/IO. Safe to call per scheduler tick.
 */

/** IIR smoothing coefficient of the live device-param slew (#746 / AU-2). */
export const AUTOMATION_SLEW_ALPHA = 0.4;

/**
 * The grain the live scheduler falls back to when handed a non-positive one.
 *
 * Kept in step with `schedulerWorker.ts`'s `msg.interval > 0 ? msg.interval : 10`
 * by `automationSlewGrainParity.spec.ts`, which drives the worker's own guard
 * rather than restating the number — so a change there fails here instead of
 * silently re-opening the divergence.
 */
const SCHEDULER_FALLBACK_GRAIN_MS = 10;

/**
 * The tick cadence the slew runs at, in seconds, for a given transport scheduler
 * grain in milliseconds.
 *
 * There is deliberately no constant here. The live cadence is one
 * {@link slewStep} per scheduler tick and the scheduler ticks every
 * `transportStore.value.scheduleGrainMs`, so the only correct offline value is
 * whatever the live path is currently reading. A constant would be a second
 * source of truth that silently agrees only at the shipping default.
 *
 * A non-finite or non-positive grain cannot describe a tick cadence; the slew
 * treats a non-positive `tickSeconds` as "do not slew", which is the honest
 * answer for a grain that could not have driven a live tick either.
 */
export function automationSlewTickSecondsForGrain(scheduleGrainMs: number): number {
    if (!Number.isFinite(scheduleGrainMs) || scheduleGrainMs <= 0) {
        // Mirror the live worker rather than refusing. `schedulerWorker.ts`
        // does `msg.interval > 0 ? msg.interval : 10`, so a non-positive grain
        // still ticks live — at 10 ms — and still slews. An earlier revision
        // returned 0 here on the reasoning that such a grain "could not have
        // driven a live tick", which is simply false: it drives one at the
        // fallback. Returning 0 would have made the bounce hold a value the
        // monitor glided, which is the same class of divergence this function
        // exists to close.
        return SCHEDULER_FALLBACK_GRAIN_MS / 1000;
    }
    return scheduleGrainMs / 1000;
}

/**
 * One step of the first-order slew: advance the smoothed value one tick toward
 * `target`. `y' = y + α·(target − y)`. Seed the first call with `previous ===
 * target` to hold (no glide from a stale value), matching the live seed.
 */
export function slewStep(previous: number, target: number, alpha: number = AUTOMATION_SLEW_ALPHA): number {
    return previous + (target - previous) * alpha;
}
