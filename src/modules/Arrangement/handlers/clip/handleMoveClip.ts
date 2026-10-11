import { getClipAutomationMoveState } from '#/modules/Automation/useCases';
import { readTempoAtBeat } from '#/modules/Transport/stores';
import { createHandler } from '#/utils/createHandler';
import { type ClipMoveActionSnapshot } from '#/utils/handlerContract';

import { moveClip } from '../../useCases/clip/moveClip';
import { audioSourceAtBeat } from '../../useCases/clipEditing/audioSourceAtBeat';
import { captureAudioSourceState } from '../../useCases/clipEditing/captureAudioSourceState';
import { prepareTakeSourceDepthMove } from '../../useCases/comping/prepareTakeSourceDepthMove';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { isMoveClipSessionEntry } from './validateClipEditSessionEntries';

function moveState(
    trackId: string,
    startBeat: number,
    endBeat: number,
    automationLanes: ClipMoveActionSnapshot['automationLanes'],
    audioSource?: ClipMoveActionSnapshot['audioSource'],
    takeSources?: ClipMoveActionSnapshot['takeSources']
): ClipMoveActionSnapshot {
    const state: ClipMoveActionSnapshot = { trackId, startBeat, endBeat, automationLanes };
    if (audioSource && takeSources) {
        return { ...state, audioSource, takeSources };
    }
    return state;
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
        const previousSource = clip.type === 'audio' ? captureAudioSourceState(clip) : undefined;
        const sourceSeconds = clip.type === 'audio' ? audioSourceAtBeat(clip, clip.startBeat).audioOffsetSeconds : 0;
        let takeSourcePlan: ReturnType<typeof prepareTakeSourceDepthMove> = null;
        if (clip.type === 'audio') {
            takeSourcePlan = prepareTakeSourceDepthMove({
                clipId: clip.id,
                oldTempo: readTempoAtBeat({ beat: clip.startBeat }),
                newTempo: readTempoAtBeat({ beat: action.payload.startBeat }),
            });
            if (!takeSourcePlan) {
                return { label: `Move clip ${clip.id}`, inverseAction: null };
            }
        }
        let nextSource: ClipMoveActionSnapshot['audioSource'];
        if (clip.type === 'audio') {
            nextSource = {
                audioOffsetSeconds: sourceSeconds,
                audioOffsetBeats: (sourceSeconds * readTempoAtBeat({ beat: action.payload.startBeat })) / 60,
            };
        }
        const previous = moveState(
            track.id,
            clip.startBeat,
            clip.endBeat,
            automation.previous,
            previousSource,
            takeSourcePlan?.before
        );
        const next = moveState(
            action.payload.trackId,
            action.payload.startBeat,
            action.payload.startBeat + (clip.endBeat - clip.startBeat),
            automation.next,
            nextSource,
            takeSourcePlan?.after
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
