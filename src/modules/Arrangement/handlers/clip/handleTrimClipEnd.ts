import { createHandler } from '#/utils/createHandler';
import {
    type AppAction,
    type ClipStretchStateSnapshot,
    type HandlerDescribeResult,
    type HandlerValidationContext,
} from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { canBeLimitedToSource } from '../../useCases/clipEditing/canBeLimitedToSource';
import { limitClipEndToSource } from '../../useCases/clipEditing/limitClipEndToSource';
import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

function stretchState(clip: Clip, endBeat: number): ClipStretchStateSnapshot {
    return {
        startBeat: clip.startBeat,
        endBeat,
        mode: { present: clip.stretchMode !== undefined, value: clip.stretchMode ?? 'off' },
        ratio: { present: clip.stretchRatio !== undefined, value: clip.stretchRatio ?? 1 },
    };
}

function restoreEnd(clip: Clip, fromEndBeat: number, toEndBeat: number): AppAction {
    return {
        type: 'restoreClipStretchState',
        payload: {
            clipId: clip.id,
            expected: stretchState(clip, fromEndBeat),
            replacement: stretchState(clip, toEndBeat),
        },
    };
}

/**
 * Undo puts the pre-trim end back and redo writes the end this trim wrote.
 * Where the source bound can apply, both replay that exact geometry: the bound
 * reads the decoded-buffer cache, so recomputing it at replay could land on a
 * different end than the history step recorded. A batch describes every member
 * before any executes, so a trim after another member cannot know the end it
 * will write; it keeps the plain trim back instead of recording a wrong one.
 */
function describeTrim(clip: Clip, newEndBeat: number, context?: HandlerValidationContext): HandlerDescribeResult {
    const label = 'Trim clip end';
    const trimBack: AppAction = { type: 'trimClipEnd', payload: { clipId: clip.id, newEndBeat: clip.endBeat } };
    const followsBatchMembers = (context?.actionIndex ?? 0) > 0;
    if (
        !Number.isFinite(newEndBeat) ||
        newEndBeat <= clip.startBeat ||
        !canBeLimitedToSource(clip) ||
        followsBatchMembers
    ) {
        return { label, inverseAction: trimBack };
    }
    const trimmedEndBeat = limitClipEndToSource(clip, newEndBeat);
    return {
        label,
        inverseAction: restoreEnd(clip, trimmedEndBeat, clip.endBeat),
        redoAction: restoreEnd(clip, clip.endBeat, trimmedEndBeat),
    };
}

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(trimClipEnd(alpha.payload.clipId, alpha.payload.newEndBeat));
    },
    describe: (alpha, context) => {
        const label = 'Trim clip end';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === alpha.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }

            return describeTrim(clip, alpha.payload.newEndBeat, context);
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
