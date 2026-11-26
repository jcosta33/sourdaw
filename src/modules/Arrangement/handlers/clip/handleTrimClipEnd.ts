import { createHandler } from '#/utils/createHandler';

import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

function liveEndBeat(clipId: string): number | undefined {
    return getTrackStoreState()
        ?.tracks.flatMap((track) => track.clips)
        .find((candidate) => candidate.id === clipId)?.endBeat;
}

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    canReapplyAfterDivergence: (alpha) => alpha.payload.expectedEndBeat !== undefined,
    validate: (alpha, context) =>
        alpha.payload.expectedEndBeat === undefined ||
        readPlannedClip(alpha.payload.clipId, context)?.endBeat === alpha.payload.expectedEndBeat,
    execute: (alpha) => {
        if (
            alpha.payload.expectedEndBeat !== undefined &&
            liveEndBeat(alpha.payload.clipId) !== alpha.payload.expectedEndBeat
        ) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(trimClipEnd(alpha.payload.clipId, alpha.payload.newEndBeat));
    },
    describe: (alpha, context) => {
        const label = 'Trim clip end';
        try {
            const clip = readPlannedClip(alpha.payload.clipId, context);
            if (!clip) {
                return { label, inverseAction: null };
            }
            // The writer ignores a request that is not past the clip's start.
            const writtenEndBeat =
                Number.isFinite(alpha.payload.newEndBeat) && alpha.payload.newEndBeat > clip.startBeat
                    ? alpha.payload.newEndBeat
                    : clip.endBeat;
            return {
                label,
                inverseAction: {
                    type: 'trimClipEnd',
                    payload: { clipId: clip.id, newEndBeat: clip.endBeat, expectedEndBeat: writtenEndBeat },
                },
                redoAction: {
                    type: 'trimClipEnd',
                    payload: { clipId: clip.id, newEndBeat: alpha.payload.newEndBeat, expectedEndBeat: clip.endBeat },
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
