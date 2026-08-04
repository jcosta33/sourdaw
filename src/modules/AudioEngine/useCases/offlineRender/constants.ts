export const MICRO_FADE_SECONDS = 0.003;

/**
 * Total wall-clock floor for the **unsegmented fallback only**.
 *
 * A render short enough to place no checkpoint, or on a context that refuses
 * `suspend`, has no progress signal at all, so a total-elapsed budget is the
 * only backstop available to it. The segmented path measures progress instead —
 * see {@link NO_PROGRESS_TIMEOUT_MS}.
 */
export const MIN_RENDER_TIMEOUT_MS = 60_000;

/** Timeout multiplier for the unsegmented fallback: wall-clock seconds per second of audio. */
export const RENDER_TIMEOUT_MULTIPLIER = 10;

/**
 * How long a segmented render may make **no forward progress** before it is
 * abandoned.
 *
 * ── Why this replaced a total-elapsed budget ──────────────────────────────
 *
 * The old rule was `Date.now() - startedAt >= timeoutMs`, enforced at every
 * checkpoint *and* again by a `setTimeout` racing the render promise. Three
 * things were wrong with it. It aborted renders that were working — a long
 * project on a slow machine passes a total budget while producing a checkpoint
 * every second. It could not abort the one case that matters, because
 * `OfflineAudioContext` has no abort API (`startRendering()`, `suspend()` and
 * `resume()` are the whole surface), so the racing timer only rejected a promise
 * while the work continued. And `Date.now()` is not monotonic, so a system clock
 * adjustment mid-render changed the verdict.
 *
 * ── Where the number comes from ───────────────────────────────────────────
 *
 * **Derived from the Phase-1 cost table, not invented.**
 * `crates/daw-dsp/benches/quantum-cost-table.md` (commit
 * `98b99045b86eb1f07cfcc7bd52e84759ff5392d2`, Apple M4 Pro `Mac16,11`, 8P+4E,
 * 24 GB, macOS 26.6, headless Chrome 150, 1-minute load average 5 on 12 logical
 * cores) reports the reference project's **worst quantum at an upper bound of
 * 1.9 ms**, against a 2.667 ms budget.
 *
 * One segment is {@link RENDER_SEGMENT_SECONDS} = 1 s of audio = 48 000 / 128 =
 * 375 quanta at 48 kHz. A segment in which *every* quantum is the worst observed
 * one therefore costs 375 × 1.9 ms ≈ **713 ms**. That is already pessimistic:
 * the worst quantum is a duty spike (Bacteria's Smudge tick, every fourth
 * quantum) and is not sustained across a whole segment.
 *
 * 10 s is that figure × 14. The factor covers a machine several times slower
 * than the one measured, an offline render competing with the UI on the main
 * thread rather than owning an audio thread, and a project heavier than the
 * reference. The threshold's job is to distinguish *wedged* from *slow*, so it
 * is deliberately generous: aborting work that is progressing is the failure
 * mode this constant exists to remove.
 *
 * **State the limit.** This is a derivation from a landed per-quantum
 * measurement, not a directly measured per-segment wall clock. Taking that
 * measurement needs a real browser render of the reference project — the same
 * harness AC-0 calls for, which this phase did not land. Re-derive it against a
 * measured segment time when that harness exists.
 */
export const NO_PROGRESS_TIMEOUT_MS = 10_000;

/**
 * How often the no-progress watchdog looks.
 *
 * It cannot be checked at checkpoint arrival, which is the trap the first draft
 * of this fell into: a wedged render produces no checkpoint, so a check that
 * only runs when one arrives never runs at all in exactly the case it exists
 * for. The watchdog is an independent timer; the abort it raises still goes
 * through the same reject-and-never-resume path a cancel does.
 */
export const NO_PROGRESS_POLL_MS = 1_000;

export const YIELD_EVERY_N_NOTES = 200;

/**
 * Maximum OfflineAudioContext frame length. Chrome enforces 2^30; Firefox is
 * higher but we cap conservatively to avoid OOM on both.
 */
export const MAX_OFFLINE_FRAMES = 2 ** 30;

/** Web Audio render quantum. `suspend()` only accepts times on this frame grid. */
export const RENDER_QUANTUM_FRAMES = 128;

/**
 * Render-time distance between offline cancel/progress checkpoints.
 *
 * Each checkpoint costs one suspend/resume round trip through the main thread,
 * so this trades abort latency against render throughput: one second of audio
 * keeps cancel responsive on long exports while leaving the per-segment
 * overhead negligible next to the work of rendering that second.
 */
export const RENDER_SEGMENT_SECONDS = 1;

/**
 * Automation lanes that drive a track's own fader and panner rather than a
 * device parameter.
 *
 * Named once because two places have to agree on the set: the strip seed, which
 * decides whether those nodes carry the stored value, and the offline automation
 * filter, which decides whether their lanes are scheduled. A render that
 * neutralised the nodes but still scheduled their lanes would bake the moves
 * whose static value it had just excluded.
 */
export const MIXER_AUTOMATION_PARAMETER_IDS = ['gain', 'pan'] as const;
