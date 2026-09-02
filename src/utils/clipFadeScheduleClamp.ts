/**
 * Shared clip-fade schedule clamp — the single source of truth for how long
 * a clip fade may occupy on either runtime (#2867).
 *
 * Offline already held each user fade to half the audible play duration so
 * the ramps cannot overlap and the clip always reaches plateau. Live did
 * not, so a fade longer than half the clip exported at full level by
 * midpoint while monitoring was still ramping. Both schedule paths call
 * this; do not fork it back into either runtime.
 *
 * The stored fade is left untouched: this is a schedule law, not a write
 * clamp. RT-safe: pure, allocation-free.
 */

/** The anti-click fade floor every scheduling leg shares. */
export const MICRO_FADE_SECONDS = 0.003;

/**
 * Cap a scheduled fade-in so it is never shorter than the anti-click floor
 * and never longer than half the audible play duration.
 */
export function clampClipFadeInDurationSeconds(
    requestedFadeInSeconds: number,
    playDurationSeconds: number,
    microFadeSeconds: number = MICRO_FADE_SECONDS
): number {
    return Math.min(Math.max(microFadeSeconds, requestedFadeInSeconds), playDurationSeconds * 0.5);
}

/**
 * Cap a scheduled fade-out start so the ramp never begins before the
 * playback does and never occupies more than the second half of the
 * audible play duration.
 */
export function clampClipFadeOutStartSeconds(
    requestedFadeOutStartSeconds: number,
    playbackStartSeconds: number,
    playDurationSeconds: number,
    _microFadeSeconds: number = MICRO_FADE_SECONDS
): number {
    const endSeconds = playbackStartSeconds + playDurationSeconds;
    return Math.max(
        playbackStartSeconds,
        Math.max(requestedFadeOutStartSeconds, endSeconds - playDurationSeconds * 0.5)
    );
}
