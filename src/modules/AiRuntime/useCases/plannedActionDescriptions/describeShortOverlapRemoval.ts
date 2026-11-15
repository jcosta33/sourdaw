import { describeShortMidiOverlapRemoval, projectShortMidiOverlapRemoval } from '#/modules/MIDI/useCases';
import { type AppAction } from '#/utils/handlerContract';

/** The overlap removal in words, or `null` when the notes project no shortening. */
export function describeShortOverlapRemoval(
    action: Extract<AppAction, { type: 'removeShortMidiOverlaps' }>
): string | null {
    const projected = projectShortMidiOverlapRemoval({
        notes: action.payload.expectedNotes,
        tempo: action.payload.expectedTempo,
        maximumOverlapMs: action.payload.maximumOverlapMs,
    });
    if (!projected) {
        return null;
    }
    return describeShortMidiOverlapRemoval({
        trackId: action.payload.expectedTrackId,
        trackName: action.payload.trackName,
        clipId: action.payload.clipId,
        clipName: action.payload.clipName,
        maximumOverlapMs: action.payload.maximumOverlapMs,
        shortenedNotes: projected.shortenedNotes,
    });
}
