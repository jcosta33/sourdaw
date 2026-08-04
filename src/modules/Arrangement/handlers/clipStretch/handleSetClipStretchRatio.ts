import { createHandler } from '#/utils/createHandler';
import { type ClipStretchStateSnapshot } from '#/utils/handlerContract';

import { clampRatio } from '../../useCases/clipStretch/helpers';
import { setClipStretchRatio } from '../../useCases/clipStretch/setClipStretchRatio';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type StretchableClip = {
    endBeat: number;
    startBeat: number;
    stretchMode?: 'off' | 'repitch' | 'timestretch';
    stretchRatio?: number;
};

function readStretchState(clip: StretchableClip): ClipStretchStateSnapshot {
    return {
        startBeat: clip.startBeat,
        endBeat: clip.endBeat,
        mode: { present: clip.stretchMode !== undefined, value: clip.stretchMode ?? 'off' },
        ratio: { present: clip.stretchRatio !== undefined, value: clip.stretchRatio ?? 1 },
    };
}

function getNextStretchState(clip: StretchableClip, ratio: number): ClipStretchStateSnapshot {
    const clampedRatio = clampRatio(ratio);
    let endBeat = clip.endBeat;
    if (clip.stretchMode === 'repitch') {
        const originalDuration = clip.endBeat - clip.startBeat;
        const previousRatio = clip.stretchRatio ?? 1;
        const baseDuration = originalDuration * previousRatio;
        endBeat = clip.startBeat + baseDuration / clampedRatio;
    }
    return {
        startBeat: clip.startBeat,
        endBeat,
        mode: { present: clip.stretchMode !== undefined, value: clip.stretchMode ?? 'off' },
        ratio: { present: true, value: clampedRatio },
    };
}

export const handleSetClipStretchRatio = createHandler<'setClipStretchRatio'>({
    execute: (action) => {
        return toHandlerExecutionResult(setClipStretchRatio(action.payload.clipId, action.payload.ratio));
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (!clip) {
            return {
                label: `Set clip ${action.payload.clipId} stretch ratio to ${action.payload.ratio}`,
                inverseAction: null,
            };
        }
        const previousState = readStretchState(clip);
        const nextState = getNextStretchState(clip, action.payload.ratio);
        return {
            label: `Set clip "${clip.name}" (${clip.id}) stretch ratio to ${action.payload.ratio}`,
            inverseAction: {
                type: 'restoreClipStretchState',
                payload: { clipId: action.payload.clipId, expected: nextState, replacement: previousState },
            },
            redoAction: {
                type: 'restoreClipStretchState',
                payload: { clipId: action.payload.clipId, expected: previousState, replacement: nextState },
            },
        };
    },
    isNoop: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return clip ? Object.is(clip.stretchRatio ?? 1, clampRatio(action.payload.ratio)) : false;
    },
    undoable: true,
});
