import { createHandler } from '#/utils/createHandler';
import { type AppAction, type ClipStretchStateSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
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

/**
 * Undo puts the pre-trim end back. A trim back to it suffices unless the clip
 * ended past its source before this trim shortened it: the source bound would
 * then stop that trim short, so the exact geometry restore replays it instead.
 */
function inverseOfTrim(clip: Clip, newEndBeat: number): AppAction {
    const trimBack: AppAction = { type: 'trimClipEnd', payload: { clipId: clip.id, newEndBeat: clip.endBeat } };
    if (!Number.isFinite(newEndBeat) || newEndBeat <= clip.startBeat) {
        return trimBack;
    }
    const trimmedEndBeat = limitClipEndToSource(clip, newEndBeat);
    if (limitClipEndToSource({ ...clip, endBeat: trimmedEndBeat }, clip.endBeat) === clip.endBeat) {
        return trimBack;
    }
    return {
        type: 'restoreClipStretchState',
        payload: {
            clipId: clip.id,
            expected: stretchState(clip, trimmedEndBeat),
            replacement: stretchState(clip, clip.endBeat),
        },
    };
}

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(trimClipEnd(alpha.payload.clipId, alpha.payload.newEndBeat));
    },
    describe: (alpha) => {
        const label = 'Trim clip end';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === alpha.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }

            return { label, inverseAction: inverseOfTrim(clip, alpha.payload.newEndBeat) };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
