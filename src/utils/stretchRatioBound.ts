/**
 * Shared stretch-ratio bound — the single source of truth for the range of
 * clip stretch ratios either runtime will realise (#2532).
 *
 * The two runtimes a bounce is compared against both evaluate this law on the
 * ratio before it touches scheduling arithmetic:
 *  - the live scheduler (Transport `scheduleAudioClips`: `playbackRate`, the
 *    pre-roll and material-span divisors, the buffer-offset multipliers), and
 *  - the offline projector (AudioEngine `projectOfflineAudioClipPlaybacks`:
 *    `safeStretchRatio`).
 *
 * The bound exists because the stored ratio is not guaranteed in range. The
 * UI write path clamps user edits to [0.25, 4] (`Arrangement/clipStretch`
 * `clampRatio`), but that is a different law for a different surface: a
 * persisted project (`isHydratableProjectData` checks `stretchRatio` for
 * finiteness only), a stem import (`projectTempo / stem.sourceTempo`), or an
 * AI-authored clip can all hand the scheduler a finite value far outside it.
 * An unbounded 0 divides the live path's derived durations into NaN/Infinity
 * and the iteration falls into the do-not-start branch — the clip is silently
 * dropped while the offline render clamps and plays it; a negative or extreme
 * ratio reaches `AudioBufferSourceNode.playbackRate` undefined-behavior
 * territory while offline clamps. Before the law was shared, only the offline
 * side bounded the value, so the two runtimes disagreed about the same
 * project. Do not fork this bound back into either path; the stretch-ratio
 * conformance siblings guard re-divergence.
 *
 * The stretchMode gate is deliberately not part of this law: whether an `off`
 * clip ignores its stored ratio is scheduler policy, and each call site keeps
 * that decision beside its own ratio resolution.
 *
 * RT-safe: pure, allocation-free, no locks/IO. Safe to call per scheduler
 * tick.
 */

/**
 * Bound a raw clip stretch ratio into the schedulable range [0.01, 100] and
 * return it. Only NaN flows through unrepaired — every write path already
 * rejects a non-finite ratio, and the hydrate check guards the persisted
 * one — while the infinities clamp to their nearest bound: +Infinity to 100,
 * -Infinity to 0.01, exactly the values the kernel spec pins.
 */
export function boundStretchRatio(stretchRatio: number): number {
    return Math.min(100, Math.max(0.01, stretchRatio));
}
