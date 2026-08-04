import { createHandler } from '#/utils/createHandler';

import { setClipFade } from '../../useCases/clipEditing/setClipFade';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetClipFade = createHandler<'setClipFade'>({
    execute: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const expectedFadeIn = action.payload.expectedFadeInBeats;
        const expectedFadeOut = action.payload.expectedFadeOutBeats;
        if (
            (expectedFadeIn !== undefined && clip?.fadeInBeats !== expectedFadeIn) ||
            (expectedFadeOut !== undefined && clip?.fadeOutBeats !== expectedFadeOut)
        ) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(
            setClipFade(action.payload.clipId, action.payload.fadeInBeats, action.payload.fadeOutBeats)
        );
    },
    describe: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        const fadeInBeats = Math.max(0, action.payload.fadeInBeats);
        const fadeOutBeats = Math.max(0, action.payload.fadeOutBeats);
        return {
            label: 'Set clip fade',
            inverseAction: clip
                ? {
                      type: 'setClipFade',
                      payload: {
                          clipId: clip.id,
                          fadeInBeats: clip.fadeInBeats,
                          fadeOutBeats: clip.fadeOutBeats,
                          expectedFadeInBeats: fadeInBeats,
                          expectedFadeOutBeats: fadeOutBeats,
                      },
                  }
                : null,
            redoAction: clip
                ? {
                      type: 'setClipFade',
                      payload: {
                          clipId: clip.id,
                          fadeInBeats,
                          fadeOutBeats,
                          expectedFadeInBeats: clip.fadeInBeats,
                          expectedFadeOutBeats: clip.fadeOutBeats,
                      },
                  }
                : action,
        };
    },
    isNoop: (action) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === action.payload.clipId);
        return (
            clip?.fadeInBeats === Math.max(0, action.payload.fadeInBeats) &&
            clip.fadeOutBeats === Math.max(0, action.payload.fadeOutBeats)
        );
    },
    undoable: true,
});
