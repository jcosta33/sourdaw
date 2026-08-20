import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type DuplicateClipToNextBarAction = { payload: { clipId: string; targetClipId?: string } };

type DuplicateClipToNextBarState = {
    targetClipId: string;
    generatedMidiStateGuard: { entityJson: string; midiByClipIdJson: string };
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

function findClipById(clipId: string) {
    const trackState = getTrackStoreState();
    if (!trackState) {
        return undefined;
    }
    for (const track of trackState.tracks) {
        const clip = track.clips.find((candidate) => candidate.id === clipId);
        if (clip) {
            return clip;
        }
    }
    return undefined;
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
        const duplicatedClip = findClipById(state.targetClipId);
        if (duplicatedClip) {
            state.generatedMidiStateGuard.entityJson = JSON.stringify(duplicatedClip);
            state.generatedMidiStateGuard.midiByClipIdJson = serializeMidiStateForClips([duplicatedClip.id]);
        }
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
