import { createHandler } from '#/utils/createHandler';

import { crossfadeClips } from '../../useCases/clipEditing/crossfadeClips';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleCrossfadeClips = createHandler<'crossfadeClips'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            crossfadeClips(alpha.payload.clipAId, alpha.payload.clipBId, alpha.payload.durationBeats)
        );
    },
    describe: (action) => {
        const clips = getTrackStoreState()?.tracks.flatMap((track) => track.clips) ?? [];
        const clipA = clips.find((clip) => clip.id === action.payload.clipAId);
        const clipB = clips.find((clip) => clip.id === action.payload.clipBId);
        const durationBeats = action.payload.durationBeats;
        if (!clipA || !clipB || clipA.id === clipB.id || !Number.isFinite(durationBeats) || durationBeats < 0) {
            return { label: 'Crossfade clips', inverseAction: null };
        }
        const halfDuration = durationBeats / 2;
        const clipAEndBeat = clipA.endBeat + halfDuration;
        const clipBStartBeat = Math.max(0, clipB.startBeat - halfDuration);
        const overlap = clipAEndBeat - clipBStartBeat;
        if (
            !Number.isFinite(clipAEndBeat) ||
            !Number.isFinite(clipBStartBeat) ||
            !Number.isFinite(overlap) ||
            overlap < 0
        ) {
            return { label: 'Crossfade clips', inverseAction: null };
        }
        const previous = {
            clipAEndBeat: clipA.endBeat,
            clipAFadeOutBeats: clipA.fadeOutBeats,
            clipBStartBeat: clipB.startBeat,
            clipBFadeInBeats: clipB.fadeInBeats,
        };
        const next = {
            clipAEndBeat,
            clipAFadeOutBeats: overlap,
            clipBStartBeat,
            clipBFadeInBeats: overlap,
        };
        return {
            label: 'Crossfade clips',
            inverseAction: {
                type: 'restoreCrossfadeClips',
                payload: {
                    clipAId: clipA.id,
                    clipBId: clipB.id,
                    expected: next,
                    replacement: previous,
                },
            },
            redoAction: {
                type: 'restoreCrossfadeClips',
                payload: {
                    clipAId: clipA.id,
                    clipBId: clipB.id,
                    expected: previous,
                    replacement: next,
                },
            },
        };
    },
    undoable: true,
});
