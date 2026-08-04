import { createHandler } from '#/utils/createHandler';

import { muteClip } from '../../useCases/clipEditing/muteClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleMuteClip = createHandler<'muteClip'>({
    execute: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        if (action.payload.expectedMuted !== undefined && clip?.muted !== action.payload.expectedMuted) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(muteClip(action.payload.clipId, action.payload.muted));
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return {
            label: action.payload.muted ? 'Mute clip' : 'Unmute clip',
            inverseAction: clip
                ? {
                      type: 'muteClip',
                      payload: { clipId: clip.id, muted: clip.muted, expectedMuted: action.payload.muted },
                  }
                : null,
            redoAction: clip
                ? {
                      type: 'muteClip',
                      payload: { clipId: clip.id, muted: action.payload.muted, expectedMuted: clip.muted },
                  }
                : action,
        };
    },
    isNoop: (action) =>
        getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((clip) => clip.id === action.payload.clipId)?.muted === action.payload.muted,
    undoable: true,
});
