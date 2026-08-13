import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { copyMidiArticulationsToNotes } from '../../transformers/copyMidiArticulationsToNotes';
import { midiNotesEqual } from '../../transformers/midiNotesEqual';
import { copyMidiArticulations } from '../../useCases/midiNoteTransforms/copyMidiArticulations';
import { getCopyMidiArticulationsStatus } from '../../useCases/midiNoteTransforms/getCopyMidiArticulationsStatus';

function describeCopy(action: Extract<AppAction, { type: 'copyMidiArticulations' }>) {
    const nextTargetNotes = copyMidiArticulationsToNotes({
        sourceNotes: action.payload.expectedSourceNotes,
        targetNotes: action.payload.expectedTargetNotes,
        notePairs: action.payload.notePairs,
    });
    if (!nextTargetNotes) {
        return { label: 'Copy MIDI articulations' };
    }
    const articulationReplayGuard = {
        trackId: action.payload.trackId,
        sourceClipId: action.payload.sourceClipId,
        expectedSourceNotes: action.payload.expectedSourceNotes,
        expectedTrackFrozen: action.payload.expectedTrackFrozen,
        expectedSourceClipLocked: action.payload.expectedSourceClipLocked,
        expectedTargetClipLocked: action.payload.expectedTargetClipLocked,
    };
    return {
        label: `Copy MIDI articulations: ${action.payload.sourceClipId} → ${action.payload.targetClipId}`,
        inverseAction: {
            type: 'restoreMidiClipNotes' as const,
            payload: {
                clipId: action.payload.targetClipId,
                notes: action.payload.expectedTargetNotes,
                expectedNotes: nextTargetNotes,
                articulationReplayGuard,
            },
        },
        redoAction: {
            type: 'restoreMidiClipNotes' as const,
            payload: {
                clipId: action.payload.targetClipId,
                notes: nextTargetNotes,
                expectedNotes: action.payload.expectedTargetNotes,
                articulationReplayGuard,
            },
        },
    };
}

export const handleCopyMidiArticulations = createHandler<'copyMidiArticulations'>({
    execute: (action) => ({ status: copyMidiArticulations(action.payload) }),
    validate: (action) => getCopyMidiArticulationsStatus(action.payload) !== 'conflict',
    describe: describeCopy,
    isNoop: (action) => {
        const nextTargetNotes = copyMidiArticulationsToNotes({
            sourceNotes: action.payload.expectedSourceNotes,
            targetNotes: action.payload.expectedTargetNotes,
            notePairs: action.payload.notePairs,
        });
        return nextTargetNotes === null || midiNotesEqual(nextTargetNotes, action.payload.expectedTargetNotes);
    },
    undoable: true,
});
