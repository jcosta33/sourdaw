export const MICRO_FADE_SECONDS = 0.003;

/** Minimum timeout floor regardless of project length. */
export const MIN_RENDER_TIMEOUT_MS = 60_000;

/** Timeout multiplier: allow this many seconds of wall-clock per second of audio. */
export const RENDER_TIMEOUT_MULTIPLIER = 10;

export const YIELD_EVERY_N_NOTES = 200;

/** Shared easing coefficient for simulated render-phase progress. */
export const PROGRESS_EASE_COEFF = 0.025;

/**
 * Maximum OfflineAudioContext frame length. Chrome enforces 2^30; Firefox is
 * higher but we cap conservatively to avoid OOM on both.
 */
export const MAX_OFFLINE_FRAMES = 2 ** 30;
