import { formatDecibels, formatGainDb, resolveLevelFields, TRACK_FADER_LAW } from '#/utils/audioLevelLaw';
import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContext } from '../../models/ProjectContext';

/**
 * What a fader request will do, in the units it was asked in.
 *
 * A linear request reads back as the amplitude it stated; a decibel request
 * reads back in decibels, and a relative one also states where the fader is
 * now and where it lands, because "by 2 dB" alone does not tell a musician
 * whether the result clears the ceiling.
 */
function describeTrackGainRequest(
    target: string,
    currentGain: number,
    payload: { gain?: number; gainDb?: number; deltaDb?: number }
): string {
    if (payload.gain !== undefined) {
        return `Set ${target} gain to ${String(payload.gain)}`;
    }
    const requested = resolveLevelFields(
        { absoluteDb: payload.gainDb, deltaDb: payload.deltaDb },
        currentGain,
        TRACK_FADER_LAW
    );
    if (!requested.ok) {
        return `Set ${target} gain: ${requested.reason}`;
    }
    const landing = `${formatGainDb(requested.linear, { trimTrailingZeros: true })} dB`;
    if (payload.deltaDb === undefined) {
        return `Set ${target} gain to ${landing}`;
    }
    const sign = payload.deltaDb > 0 ? '+' : '';
    const change = `${sign}${formatDecibels(payload.deltaDb, { trimTrailingZeros: true })} dB`;
    return `Set ${target} gain by ${change} (from ${formatGainDb(currentGain, { trimTrailingZeros: true })} dB to ${landing})`;
}

/** The fader request in words, or `null` when the track is not in the snapshot. */
export function describeTrackGain(
    action: Extract<AppAction, { type: 'setTrackGain' }>,
    context: ProjectContext
): string | null {
    const track = context.tracks.find((candidate) => candidate.id === action.payload.trackId);
    if (!track) {
        return null;
    }
    return describeTrackGainRequest(`track "${track.name}" (${track.id})`, track.gain, action.payload);
}
