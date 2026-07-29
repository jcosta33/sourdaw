export const MICRO_FADE_SECONDS = 0.003;

/** Minimum timeout floor regardless of project length. */
export const MIN_RENDER_TIMEOUT_MS = 60_000;

/** Timeout multiplier: allow this many seconds of wall-clock per second of audio. */
export const RENDER_TIMEOUT_MULTIPLIER = 10;

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
