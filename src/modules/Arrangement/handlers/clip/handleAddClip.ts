import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { addClip } from '../../useCases/clip/addClip';
import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { getPlannedTrackState } from '../getPlannedTrackState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';
import { isAddClipSessionEntry } from '../validateCreationSessionEntries';

import { prepareCreatedClipRedoGuard } from './prepareCreatedClipRedoGuard';

type AddClipAction = { payload: { id?: string } };

type AddClipState = {
    clipId: string;
    generatedMidiStateGuard: { entityJson: string; midiByClipIdJson: string };
    publishRedoGuard?: () => void;
};

const addClipStates = new WeakMap<object, AddClipState>();

function getAddClipState(action: AddClipAction): AddClipState {
    const existing = addClipStates.get(action);
    if (existing) {
        return existing;
    }
    const state = {
        clipId: action.payload.id ?? getNextAppActionClipId(),
        generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' },
    };
    addClipStates.set(action, state);
    return state;
}

export const handleAddClip = createHandler<'addClip'>({
    validateSessionEntry: isAddClipSessionEntry,
    validate: (action, context) => {
        const track = getPlannedTrackState(context, action.payload.trackId);
        return (
            track !== null &&
            track.frozen !== true &&
            Number.isFinite(action.payload.startBeat) &&
            Number.isFinite(action.payload.endBeat) &&
            action.payload.startBeat >= 0 &&
            action.payload.endBeat > action.payload.startBeat
        );
    },
    execute: (alpha) => {
        const state = getAddClipState(alpha);
        const clip = addClip({ ...alpha.payload, id: state.clipId });
        if (!clip) {
            return toHandlerExecutionResult(false);
        }
        state.generatedMidiStateGuard.entityJson = JSON.stringify(clip);
        state.generatedMidiStateGuard.midiByClipIdJson = serializeMidiStateForClips([clip.id]);
        if (state.publishRedoGuard) {
            return {
                status: 'written',
                afterCommit: state.publishRedoGuard,
                afterAmbiguousCommit: () => {
                    // Ambiguous publication cannot authorize replacing the saved inverse.
                },
            };
        }
        return toHandlerExecutionResult(true);
    },
    describe: (alpha, context) => {
        const state = getAddClipState(alpha);
        state.publishRedoGuard = prepareCreatedClipRedoGuard({
            recordedRedo: context?.recordedRedo,
            clipId: state.clipId,
            guard: state.generatedMidiStateGuard,
        });
        return {
            label: `Add clip "${alpha.payload.name}"`,
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: state.clipId, generatedMidiStateGuard: state.generatedMidiStateGuard },
            },
            redoAction: { type: 'addClip', payload: { ...alpha.payload, id: state.clipId } },
        };
    },
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
