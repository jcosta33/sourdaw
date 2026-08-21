import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { getAllTracks } from '../getAllTracks';

import { isToasterPadTrack, TOASTER_PAD_MAX_GAIN } from './isToasterPadTrack';

/**
 * The highest gain a track's fader may *ask* for.
 *
 * One function, because the control and the writer must not hold second
 * opinions about it. `setTrackGain` clamps to this, and the mixer strip bounds
 * its travel by it, so a strip cannot request a value the writer refuses — and
 * the refusal is not merely cosmetic: `handleSetTrackGain` builds the undo
 * entry's `expectedGain` from the *request*, so a Toaster-pad-mirrored track
 * dragged from `0.8` to `1.5` would record an inverse expecting `1.5` against a
 * stored `1`, and `execute`'s equality check returns `conflict` on the way
 * back. The fader snaps to unity, the original `0.8` is unrecoverable, and the
 * dead entry still occupies one of the shared history's slots.
 *
 * It is {@link FADER_MAX_GAIN} everywhere except a pad-mirrored track, which
 * {@link TOASTER_PAD_MAX_GAIN} holds at unity for the series-gain reason that
 * constant states.
 */
export function getTrackFaderCeiling(trackId: string): number {
    return isToasterPadTrack(trackId, { getAllTracks }) ? TOASTER_PAD_MAX_GAIN : FADER_MAX_GAIN;
}
