import { createHandler } from '#/utils/createHandler';

import { slipClipContent } from '../../useCases/clipEditing/slipClipContent';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSlipClipContent = createHandler<'slipClipContent'>({
    execute: (action) => {
        return toHandlerExecutionResult(
            slipClipContent(action.payload.clipId, action.payload.clipType, action.payload.offset)
        );
    },
    describe: (action) => {
        const label = 'Slip clip content';
        try {
            const state = getTrackStoreState();
            const clip = state?.tracks
                .flatMap((time) => time.clips)
                .find((context) => context.id === action.payload.clipId);
            if (!clip) {
                return { label, inverseAction: null };
            }
            // Slip sets the offset wholesale, so the exact inverse is the same
            // action carrying the offset captured before the write — 0 when the
            // clip never carried one, matching the gesture's own baseline.
            const previousOffset =
                action.payload.clipType === 'audio' ? (clip.audioOffsetBeats ?? 0) : (clip.midiOffsetBeats ?? 0);
            return {
                label,
                inverseAction: {
                    type: 'slipClipContent',
                    payload: { clipId: clip.id, clipType: action.payload.clipType, offset: previousOffset },
                },
            };
        } catch {
            return { label, inverseAction: null };
        }
    },
    undoable: true,
});
