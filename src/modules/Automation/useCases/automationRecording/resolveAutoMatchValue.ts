import { AUTOMATCH_RELEASE_SECONDS, pendingAutoMatch } from './autoMatchState';
import { makeKey } from './makeKey';

type ResolveAutoMatchValueInput = {
    trackId: string;
    parameterId: string;
    /** The value the automation curve reads at the current position. */
    automationValue: number;
    /** Current engine time, in seconds. */
    nowSeconds: number;
};

type ResolveAutoMatchValueOutput = {
    /** The value to apply this tick: the curve value, or the release blend. */
    value: number;
    /**
     * True only on the first tick of a glide. The caller uses it to re-seed any
     * per-parameter smoothing at the released value: during the ride the lane is
     * skipped, so the smoother's stored value is a stale pre-ride one, and
     * letting it glide from there would start the AutoMatch from the wrong
     * place.
     */
    isReleaseStart: boolean;
};

/**
 * Resolve the value a released control should take this tick.
 *
 * With no pending release this returns the curve value untouched, so the normal
 * playback path is unaffected. While a release is gliding it returns a linear
 * blend from the released value to the curve value across
 * {@link AUTOMATCH_RELEASE_SECONDS}, and once the glide completes it forgets the
 * release and hands back the curve.
 *
 * The ramp is measured in seconds on the engine clock, not in beats: AutoMatch
 * is a *rate*, and a beat-measured glide would change length with the tempo.
 */
export function resolveAutoMatchValue({
    trackId,
    parameterId,
    automationValue,
    nowSeconds,
}: ResolveAutoMatchValueInput): ResolveAutoMatchValueOutput {
    const key = makeKey(trackId, parameterId);
    const release = pendingAutoMatch.get(key);
    if (!release) {
        return { value: automationValue, isReleaseStart: false };
    }

    if (release.startedAtSeconds === null) {
        release.startedAtSeconds = nowSeconds;
        return { value: release.releasedValue, isReleaseStart: true };
    }

    const progress = (nowSeconds - release.startedAtSeconds) / AUTOMATCH_RELEASE_SECONDS;
    if (progress >= 1) {
        pendingAutoMatch.delete(key);
        return { value: automationValue, isReleaseStart: false };
    }
    // A tick before the stamped start (the clock cannot run backwards in
    // practice, but a seek can re-anchor it) holds at the released value rather
    // than extrapolating past it.
    if (progress <= 0) {
        return { value: release.releasedValue, isReleaseStart: false };
    }

    const blended = release.releasedValue + (automationValue - release.releasedValue) * progress;
    return { value: blended, isReleaseStart: false };
}
