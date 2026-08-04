import { createHandler } from '#/utils/createHandler';

import { setClipColor } from '../../useCases/clipEditing/setClipColor';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipColor = createHandler<'setClipColor'>({
    execute: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (action.payload.expectedColor !== undefined && clip?.color !== action.payload.expectedColor) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(setClipColor(action.payload.clipId, action.payload.color));
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return {
            label: 'Set clip color',
            inverseAction: clip
                ? {
                      type: 'setClipColor',
                      payload: { clipId: clip.id, color: clip.color, expectedColor: action.payload.color },
                  }
                : null,
            redoAction: clip
                ? {
                      type: 'setClipColor',
                      payload: { clipId: clip.id, color: action.payload.color, expectedColor: clip.color },
                  }
                : action,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((clip) => clip.id === action.payload.clipId)?.color === action.payload.color,
    undoable: true,
});
