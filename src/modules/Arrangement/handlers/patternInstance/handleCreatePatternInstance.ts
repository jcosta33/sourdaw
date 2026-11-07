import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { createPatternInstance } from '../../useCases/patternInstance/createPatternInstance';
import { prepareCreatedClipRedoGuard } from '../clip/prepareCreatedClipRedoGuard';
import { stampCreatedClipStateGuard } from '../clip/stampCreatedClipStateGuard';

type CreateAction = Extract<AppAction, { type: 'createPatternInstance' }>;
type CreationState = {
    targetClipId: string;
    guard: GeneratedMidiStateGuard;
    stageRedoGuard?: (action: AppAction) => void;
};
const states = new WeakMap<CreateAction, CreationState>();

function getState(action: CreateAction): CreationState {
    const previous = states.get(action);
    if (previous) {
        return previous;
    }
    const targetClipId = action.payload.targetClipId ?? `clip-inst-${crypto.randomUUID()}`;
    action.payload.targetClipId = targetClipId;
    const state = { targetClipId, guard: { entityJson: '', midiByClipIdJson: '' } };
    states.set(action, state);
    return state;
}

export const handleCreatePatternInstance = createHandler<'createPatternInstance'>({
    batchExecution: 'singleton',
    materializeCommandArguments: (action) => {
        getState(action);
    },
    execute: (alpha) => {
        const state = getState(alpha);
        const instanceId = createPatternInstance(
            alpha.payload.sourceClipId,
            alpha.payload.targetTrackId,
            alpha.payload.startBeat,
            state.targetClipId
        );
        if (instanceId === null) {
            return { status: 'no-write' };
        }
        stampCreatedClipStateGuard(state.guard, instanceId);
        if (state.stageRedoGuard) {
            state.stageRedoGuard(alpha);
            return {
                status: 'written',
                afterCommit: () => {
                    // Command settles the staged capture with its owning publication.
                },
                afterAmbiguousCommit: () => {
                    commitRedoInverseCapture({ phase: 'discard', actions: [alpha] });
                },
            };
        }
        return { status: 'written' };
    },
    undoable: true,
    describe: (action, context) => {
        const state = getState(action);
        state.stageRedoGuard = prepareCreatedClipRedoGuard({
            recordedRedo: context?.recordedRedo,
            clipId: state.targetClipId,
            guard: state.guard,
        });
        return {
            label: 'Create Pattern Instance',
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: state.targetClipId, generatedMidiStateGuard: state.guard },
            },
        };
    },
});
