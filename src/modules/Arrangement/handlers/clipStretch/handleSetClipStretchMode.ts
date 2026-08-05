import { createHandler } from '#/utils/createHandler';
import { type ClipStretchStateSnapshot } from '#/utils/handlerContract';

import { setClipStretchMode } from '../../useCases/clipStretch/setClipStretchMode';
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

export const handleSetClipStretchMode = createHandler<'setClipStretchMode'>({
    execute: (action) => {
        return toHandlerExecutionResult(setClipStretchMode(action.payload.clipId, action.payload.mode));
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (!clip) {
            return {
                label: `Set clip ${action.payload.clipId} stretch mode to ${action.payload.mode}`,
                inverseAction: null,
            };
        }
        const previousState = readStretchState(clip);
        const nextState: ClipStretchStateSnapshot = {
            ...previousState,
            mode: { present: true, value: action.payload.mode },
        };
        return {
            label: `Set clip "${clip.name}" (${clip.id}) stretch mode to ${action.payload.mode}`,
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
        return clip ? (clip.stretchMode ?? 'off') === action.payload.mode : false;
    },
    undoable: true,
});
