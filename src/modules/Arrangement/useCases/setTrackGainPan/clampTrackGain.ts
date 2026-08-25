import { clampFaderGain } from '#/utils/audioLevelLaw';

/**
 * The gain a request for `gain` actually becomes: the fader law's own clamp.
 *
 * One function, because a caller that predicts the write and a caller that
 * performs it must not compute it twice. `setTrackGain` writes through here,
 * and `handleSetTrackGain` builds its undo entry from here — the two
 * disagreeing is precisely the failure this exists to prevent, since that
 * handler's inverse carries an `expectedGain` that `execute` later compares
 * against the stored value. An inverse built from an unclamped *request*
 * against a clamped stored result never validates, so the undo returns
 * `conflict` and the pre-move value is unrecoverable.
 */
export function clampTrackGain(gain: number): number {
    return clampFaderGain(gain);
}
