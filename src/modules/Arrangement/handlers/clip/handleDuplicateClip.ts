import { serializeMidiStateForClips } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type GeneratedMidiStateGuard } from '#/utils/handlerContract';

import { serializeClipSatelliteEntries } from '../../stores/clipSatelliteState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { duplicateClip } from '../../useCases/clip/duplicateClip';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { serializeClipScopedAutomationLanes } from '../../useCases/clip/serializeClipScopedAutomationLanes';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type DuplicateClipAction = { payload: { clipId: string; targetClipId?: string } };

type DuplicateClipState = {
    targetClipId: string;
    generatedMidiStateGuard: GeneratedMidiStateGuard;
};

const duplicateClipStates = new WeakMap<object, DuplicateClipState>();

function ensureTargetClipId(action: DuplicateClipAction): string {
    if (action.payload.targetClipId) {
        return action.payload.targetClipId;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    action.payload.targetClipId = targetClipId;
    return targetClipId;
}

function getDuplicateClipState(action: DuplicateClipAction): DuplicateClipState {
    const existing = duplicateClipStates.get(action);
    if (existing) {
        return existing;
    }
    const state = {
        targetClipId: ensureTargetClipId(action),
        generatedMidiStateGuard: { entityJson: '', midiByClipIdJson: '' },
    };
    duplicateClipStates.set(action, state);
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

function isDuplicateClipNoop(action: DuplicateClipAction): boolean {
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

export const handleDuplicateClip = createHandler<'duplicateClip'>({
    // Batch co-execution preflights the same applicability bar `isNoop` encodes
    // for the single-action route (source and destination eligible, target id
    // fresh). Single-action dispatch never calls validate.
    validate: (action) => !isDuplicateClipNoop(action),
    materializeCommandArguments: (action) => {
        ensureTargetClipId(action);
    },
    execute: (alpha) => {
        const state = getDuplicateClipState(alpha);
        const succeeded = duplicateClip({
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
            // The duplicate clones the source's gain envelope, warp state, and
            // clip-scoped automation lanes, so the guard must expect exactly
            // those — requiring absence would make the copy's own undo conflict
            // on what the copy itself made.
            state.generatedMidiStateGuard.clipSatellitesJson = serializeClipSatelliteEntries([duplicatedClip.id]);
            state.generatedMidiStateGuard.clipAutomationLanesJson = serializeClipScopedAutomationLanes([
                duplicatedClip.id,
            ]);
        }
        return toHandlerExecutionResult(true);
    },
    describe: (alpha) => {
        const state = getDuplicateClipState(alpha);
        return {
            label: 'Duplicate clip',
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: state.targetClipId, generatedMidiStateGuard: state.generatedMidiStateGuard },
            },
        };
    },
    isNoop: isDuplicateClipNoop,
    undoable: true,
});
