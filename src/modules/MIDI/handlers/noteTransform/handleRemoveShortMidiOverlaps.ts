import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { midiNotesEqual } from '../../transformers/midiNotesEqual';
import { describeShortMidiOverlapRemoval } from '../../useCases/midiNoteTransforms/describeShortMidiOverlapRemoval';
import { getRemoveShortMidiOverlapsStatus } from '../../useCases/midiNoteTransforms/getRemoveShortMidiOverlapsStatus';
import { projectShortMidiOverlapRemoval } from '../../useCases/midiNoteTransforms/projectShortMidiOverlapRemoval';
import { removeShortMidiOverlaps } from '../../useCases/midiNoteTransforms/removeShortMidiOverlaps';

function prepareRemoveShortMidiOverlaps(action: Extract<AppAction, { type: 'removeShortMidiOverlaps' }>) {
    const projected = projectShortMidiOverlapRemoval({
        notes: action.payload.expectedNotes,
        tempo: action.payload.expectedTempo,
        maximumOverlapMs: action.payload.maximumOverlapMs,
    });
    if (!projected) {
        return { description: { label: 'Remove short MIDI overlaps' }, isNoop: true };
    }
    const label = describeShortMidiOverlapRemoval({
        trackId: action.payload.expectedTrackId,
        trackName: action.payload.trackName,
        clipId: action.payload.clipId,
        clipName: action.payload.clipName,
        maximumOverlapMs: action.payload.maximumOverlapMs,
        shortenedNotes: projected.shortenedNotes,
    });
    const eligibilityGuard = {
        trackId: action.payload.expectedTrackId,
        expectedTrackFrozen: action.payload.expectedTrackFrozen,
        expectedClipLocked: action.payload.expectedClipLocked,
    };
    return {
        description: {
            label,
            inverseAction: {
                type: 'restoreMidiClipNotes' as const,
                payload: {
                    clipId: action.payload.clipId,
                    notes: action.payload.expectedNotes,
                    expectedNotes: projected.notes,
                    noteTransformReplayGuard: eligibilityGuard,
                },
            },
            redoAction: {
                type: 'restoreMidiClipNotes' as const,
                payload: {
                    clipId: action.payload.clipId,
                    notes: projected.notes,
                    expectedNotes: action.payload.expectedNotes,
                    noteTransformReplayGuard: {
                        ...eligibilityGuard,
                        expectedTempo: action.payload.expectedTempo,
                    },
                },
            },
        },
        isNoop: midiNotesEqual(projected.notes, action.payload.expectedNotes),
    };
}

export const handleRemoveShortMidiOverlaps = createHandler<'removeShortMidiOverlaps'>({
    validate: (action) => getRemoveShortMidiOverlapsStatus(action.payload) !== 'conflict',
    execute: (action) => ({ status: removeShortMidiOverlaps(action.payload) }),
    describe: (action) => prepareRemoveShortMidiOverlaps(action).description,
    isNoop: (action) => prepareRemoveShortMidiOverlaps(action).isNoop,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
