import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { addClip } from '../../useCases/clip/addClip';
import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddClipAction = { payload: { id?: string } };

type AddClipState = {
    clipId: string;
    generatedMidiStateGuard: { entityJson: string; midiByClipIdJson: string };
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
    execute: (alpha) => {
        const state = getAddClipState(alpha);
        const clip = addClip({ ...alpha.payload, id: state.clipId });
        if (!clip) {
            return toHandlerExecutionResult(false);
        }
        state.generatedMidiStateGuard.entityJson = JSON.stringify(clip);
        state.generatedMidiStateGuard.midiByClipIdJson = serializeMidiStateForClips([clip.id]);
        return toHandlerExecutionResult(true);
    },
    describe: (alpha) => {
        const state = getAddClipState(alpha);
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
