import { getClipAutomationMoveState } from '#/modules/Automation/useCases';
import { createHandler } from '#/utils/createHandler';
import { type ClipMoveActionSnapshot } from '#/utils/handlerContract';

import { moveClip } from '../../useCases/clip/moveClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { isMoveClipSessionEntry } from './validateClipPlacementSessionEntries';

function moveState(
    trackId: string,
    startBeat: number,
    endBeat: number,
    automationLanes: ClipMoveActionSnapshot['automationLanes'],
    slot?: Pick<ClipMoveActionSnapshot, 'clipIndex' | 'beforeClipId' | 'afterClipId'>
): ClipMoveActionSnapshot {
    return { trackId, startBeat, endBeat, automationLanes, ...slot };
}

function captureSlot(clips: readonly { id: string }[], index: number) {
    const slot: { clipIndex: number; beforeClipId?: string; afterClipId?: string } = { clipIndex: index };
    if (index > 0) {
        slot.beforeClipId = clips[index - 1]!.id;
    }
    if (index < clips.length) {
        slot.afterClipId = clips[index]!.id;
    }
    return slot;
}

function placementsMatch(left: ClipMoveActionSnapshot, right: ClipMoveActionSnapshot): boolean {
    return (
        left.trackId === right.trackId &&
        Object.is(left.startBeat, right.startBeat) &&
        Object.is(left.endBeat, right.endBeat)
    );
}

export const handleMoveClip = createHandler<'moveClip'>({
    validateSessionEntry: isMoveClipSessionEntry,
    execute: (action) => {
        return toHandlerExecutionResult(
            moveClip(action.payload.clipId, action.payload.trackId, action.payload.startBeat)
        );
    },
    describe: (action) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((candidate) =>
            candidate.clips.some((clip) => clip.id === action.payload.clipId)
        );
        const clip = track?.clips.find((candidate) => candidate.id === action.payload.clipId);
        if (!track || !clip) {
            return {
                label: `Move clip ${action.payload.clipId} to track ${action.payload.trackId} at beat ${action.payload.startBeat}`,
                inverseAction: null,
            };
        }
        const beatDelta = action.payload.startBeat - clip.startBeat;
        const automation = getClipAutomationMoveState({
            clipId: clip.id,
            targetTrackId: action.payload.trackId,
            beatDelta,
        });
        const targetTrack = state?.tracks.find((candidate) => candidate.id === action.payload.trackId);
        let targetSlot: ReturnType<typeof captureSlot> | undefined;
        if (track.id !== action.payload.trackId && targetTrack) {
            targetSlot = captureSlot(targetTrack.clips, targetTrack.clips.length);
        }
        const sourceIndex = track.clips.findIndex((candidate) => candidate.id === clip.id);
        let sourceSlot: ReturnType<typeof captureSlot> | undefined;
        if (targetSlot) {
            sourceSlot = captureSlot(
                track.clips.filter((candidate) => candidate.id !== clip.id),
                sourceIndex
            );
        }
        const previous = moveState(track.id, clip.startBeat, clip.endBeat, automation.previous, sourceSlot);
        const next = moveState(
            action.payload.trackId,
            action.payload.startBeat,
            action.payload.startBeat + (clip.endBeat - clip.startBeat),
            automation.next,
            targetSlot
        );
        return {
            label: `Move clip "${clip.name}" (${clip.id}) to track ${action.payload.trackId} at beat ${action.payload.startBeat}`,
            inverseAction: {
                type: 'restoreClipPlacement',
                payload: { clipId: clip.id, expected: next, replacement: previous },
            },
            redoAction: {
                type: 'restoreClipPlacement',
                payload: { clipId: clip.id, expected: previous, replacement: next },
            },
        };
    },
    isNoop: (action) => {
        const state = getTrackStoreState();
        const track = state?.tracks.find((candidate) =>
            candidate.clips.some((clip) => clip.id === action.payload.clipId)
        );
        const clip = track?.clips.find((candidate) => candidate.id === action.payload.clipId);
        if (!track || !clip) {
            return false;
        }
        const current = moveState(track.id, clip.startBeat, clip.endBeat, []);
        const next = moveState(
            action.payload.trackId,
            action.payload.startBeat,
            action.payload.startBeat + (clip.endBeat - clip.startBeat),
            []
        );
        return placementsMatch(current, next);
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
