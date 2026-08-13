import { createHandler } from '#/utils/createHandler';
import { type ClipStretchStateSnapshot } from '#/utils/handlerContract';

import { fitClipToBeats } from '../../useCases/clipStretch/fitClipToBeats';
import { clampRatio } from '../../useCases/clipStretch/helpers';
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

function getNextStretchState(clip: StretchableClip, targetBeats: number): ClipStretchStateSnapshot {
    const currentDuration = clip.endBeat - clip.startBeat;
    const previousRatio = clip.stretchRatio ?? 1;
    const ratio = clampRatio((currentDuration * previousRatio) / targetBeats);
    const mode = clip.stretchMode === 'off' ? 'repitch' : (clip.stretchMode ?? 'off');
    return {
        startBeat: clip.startBeat,
        endBeat: clip.startBeat + targetBeats,
        mode: { present: clip.stretchMode === 'off' || clip.stretchMode !== undefined, value: mode },
        ratio: { present: true, value: ratio },
    };
}

function statesMatch(left: ClipStretchStateSnapshot, right: ClipStretchStateSnapshot): boolean {
    return (
        Object.is(left.startBeat, right.startBeat) &&
        Object.is(left.endBeat, right.endBeat) &&
        left.mode.present === right.mode.present &&
        left.mode.value === right.mode.value &&
        left.ratio.present === right.ratio.present &&
        Object.is(left.ratio.value, right.ratio.value)
    );
}

export const handleFitClipToBeats = createHandler<'fitClipToBeats'>({
    execute: (action) => {
        return toHandlerExecutionResult(fitClipToBeats(action.payload.clipId, action.payload.targetBeats));
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (!clip) {
            return {
                label: `Fit clip ${action.payload.clipId} to ${action.payload.targetBeats} beats`,
                inverseAction: null,
            };
        }
        const previousState = readStretchState(clip);
        const nextState = getNextStretchState(clip, action.payload.targetBeats);
        return {
            label: `Fit clip "${clip.name}" (${clip.id}) to ${action.payload.targetBeats} beats`,
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
        return clip
            ? statesMatch(readStretchState(clip), getNextStretchState(clip, action.payload.targetBeats))
            : false;
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
