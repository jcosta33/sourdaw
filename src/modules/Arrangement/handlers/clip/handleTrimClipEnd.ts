import { createHandler } from '#/utils/createHandler';

import { planEndTrim } from '../../useCases/clipEditing/planEndTrim';
import { trimClipEnd } from '../../useCases/clipEditing/trimClipEnd';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

import { readPlannedClip } from './readPlannedClip';

export const handleTrimClipEnd = createHandler<'trimClipEnd'>({
    canReapplyAfterDivergence: (alpha) => alpha.payload.expectedEndBeat !== undefined,
    validate: (alpha, context) =>
        alpha.payload.expectedEndBeat === undefined ||
        readPlannedClip(alpha.payload.clipId, context)?.endBeat === alpha.payload.expectedEndBeat,
    execute: (alpha) => {
        if (
            alpha.payload.expectedEndBeat !== undefined &&
            readPlannedClip(alpha.payload.clipId)?.endBeat !== alpha.payload.expectedEndBeat
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
            const writtenEndBeat = planEndTrim(clip, alpha.payload.newEndBeat)?.endBeat ?? clip.endBeat;
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
