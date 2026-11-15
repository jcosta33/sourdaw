import { type AppAction } from '#/utils/handlerContract';

/** The section gain lift in words, or `null` until its tracks are materialized. */
export function describeExactTrackGainRange(
    action: Extract<AppAction, { type: 'automateTrackGainRange' }>
): string | null {
    if (!action.payload.expectedTracks) {
        return null;
    }
    const targets = action.payload.expectedTracks
        .map(
            (track) =>
                `"${track.trackName}" (${track.trackId}) ${String(track.gain)}→${String(track.gain * 10 ** (action.payload.gainDb / 20))}`
        )
        .join(', ');
    return `Lift ${targets} by ${String(action.payload.gainDb)} dB only in ${action.payload.sectionName} beats ${String(action.payload.startBeat)}–${String(action.payload.endBeat)}`;
}
