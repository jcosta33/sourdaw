import { commitRedoInverseCapture } from '#/modules/Command/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { prepareCreatedClipRedoGuard } from './prepareCreatedClipRedoGuard';
import { stampCreatedClipStateGuard } from './stampCreatedClipStateGuard';

type DuplicateClipToNextBarAction = { payload: { clipId: string; targetClipId?: string } };

type DuplicateClipToNextBarState = {
    targetClipId: string;
    generatedMidiStateGuard: GeneratedMidiStateGuard;
    stageRedoGuard?: (action: AppAction) => void;
};

const duplicateClipToNextBarStates = new WeakMap<object, DuplicateClipToNextBarState>();

function ensureTargetClipId(action: DuplicateClipToNextBarAction): string {
    if (action.payload.targetClipId) {
        return action.payload.targetClipId;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    action.payload.targetClipId = targetClipId;
    return targetClipId;
}

function getDuplicateClipToNextBarState(action: DuplicateClipToNextBarAction): DuplicateClipToNextBarState {
    const existing = duplicateClipToNextBarStates.get(action);
    if (existing) {
        return existing;
    }
    const state = {
        targetClipId: ensureTargetClipId(action),
        generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' },
    };
    duplicateClipToNextBarStates.set(action, state);
    return state;
}

function isDuplicateClipToNextBarNoop(action: DuplicateClipToNextBarAction): boolean {
    const sourceTarget = resolveEligibleClipWriteTarget({ clipId: action.payload.clipId });
    if (sourceTarget.status !== 'eligible' || !('clipId' in sourceTarget)) {
        return true;
    }

    const destinationTarget = resolveEligibleClipWriteTarget({ trackId: sourceTarget.trackId });
    if (destinationTarget.status !== 'eligible') {
        return true;
    }

    const targetClipId = action.payload.targetClipId;
    if (targetClipId === undefined) {
        return false;
    }
    if (targetClipId.length === 0) {
        return true;
    }

    return resolveEligibleClipWriteTarget({ clipId: targetClipId }).status !== 'missing';
}

export const handleDuplicateClipToNextBar = createHandler<'duplicateClipToNextBar'>({
    materializeCommandArguments: (action) => {
        ensureTargetClipId(action);
    },
    execute: (alpha) => {
        const state = getDuplicateClipToNextBarState(alpha);
        const succeeded = duplicateClipToNextBar({
            clipId: alpha.payload.clipId,
            targetClipId: state.targetClipId,
        });
        if (!succeeded) {
            return toHandlerExecutionResult(false);
        }
        stampCreatedClipStateGuard(state.generatedMidiStateGuard, state.targetClipId);
        if (state.stageRedoGuard) {
            state.stageRedoGuard(alpha);
            return {
                status: 'written',
                afterCommit: () => {
                    // Command settles every staged inverse together after these effects complete.
                },
                afterAmbiguousCommit: () => {
                    commitRedoInverseCapture({ phase: 'discard', actions: [alpha] });
                },
            };
        }
        return toHandlerExecutionResult(true);
    },
    describe: (alpha, context) => {
        const state = getDuplicateClipToNextBarState(alpha);
        state.stageRedoGuard = prepareCreatedClipRedoGuard({
            recordedRedo: context?.recordedRedo,
            clipId: state.targetClipId,
            guard: state.generatedMidiStateGuard,
        });
        return {
            label: 'Duplicate clip to next bar',
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: state.targetClipId, generatedMidiStateGuard: state.generatedMidiStateGuard },
            },
        };
    },
    isNoop: isDuplicateClipToNextBarNoop,
    undoable: true,
});
