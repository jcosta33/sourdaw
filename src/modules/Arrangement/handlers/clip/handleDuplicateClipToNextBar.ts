import { createHandler } from '#/utils/createHandler';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { stampCreatedClipStateGuard } from './stampCreatedClipStateGuard';

type DuplicateClipToNextBarAction = { payload: { clipId: string; targetClipId?: string } };

type DuplicateClipToNextBarState = {
    targetClipId: string;
    generatedMidiStateGuard: GeneratedMidiStateGuard;
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
        return toHandlerExecutionResult(true);
    },
    describe: (alpha) => {
        const state = getDuplicateClipToNextBarState(alpha);
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
