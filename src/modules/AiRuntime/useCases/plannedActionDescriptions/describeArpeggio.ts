import { type AppAction } from '#/utils/handlerContract';

/** The syncopated arpeggio in words, or `null` until its scope facts are materialized. */
export function describeArpeggio(action: Extract<AppAction, { type: 'arpeggiate' }>): string | null {
    if (
        !action.payload.expectedTrackId ||
        !action.payload.trackName ||
        !action.payload.clipName ||
        !action.payload.expectedNotes ||
        !action.payload.addedNotes
    ) {
        return null;
    }
    return `Track "${action.payload.trackName}" (${action.payload.expectedTrackId}), clip "${action.payload.clipName}" (${action.payload.clipId}): add ${String(action.payload.addedNotes.length)} syncopated offbeat eighth-note arpeggio notes; preserve ${String(action.payload.expectedNotes.length)} source notes, absolute voicing, velocities, expression, and harmonic boundaries`;
}
