import { createHandler } from '#/utils/createHandler';

import { restoreCrossfadeClips } from '../../useCases/clipEditing/restoreCrossfadeClips';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type ReadCrossfadeSnapshotInput = {
    clipA: { endBeat: number; fadeOutBeats: number };
    clipB: { startBeat: number; fadeInBeats: number };
};

function readCrossfadeSnapshot({ clipA, clipB }: ReadCrossfadeSnapshotInput) {
    return {
        clipAEndBeat: clipA.endBeat,
        clipAFadeOutBeats: clipA.fadeOutBeats,
        clipBStartBeat: clipB.startBeat,
        clipBFadeInBeats: clipB.fadeInBeats,
    };
}

type SnapshotsMatchInput = {
    left: ReturnType<typeof readCrossfadeSnapshot>;
    right: ReturnType<typeof readCrossfadeSnapshot>;
};

function snapshotsMatch({ left, right }: SnapshotsMatchInput) {
    return (
        left.clipAEndBeat === right.clipAEndBeat &&
        left.clipAFadeOutBeats === right.clipAFadeOutBeats &&
        left.clipBStartBeat === right.clipBStartBeat &&
        left.clipBFadeInBeats === right.clipBFadeInBeats
    );
}

export const handleRestoreCrossfadeClips = createHandler<'restoreCrossfadeClips'>({
    execute: (action) => {
        const clips = getTrackStoreState()?.tracks.flatMap((track) => track.clips) ?? [];
        const clipA = clips.find((clip) => clip.id === action.payload.clipAId);
        const clipB = clips.find((clip) => clip.id === action.payload.clipBId);
        if (
            !clipA ||
            !clipB ||
            clipA.locked ||
            clipB.locked ||
            !snapshotsMatch({ left: readCrossfadeSnapshot({ clipA, clipB }), right: action.payload.expected })
        ) {
            return { status: 'conflict' };
        }
        return toHandlerExecutionResult(
            restoreCrossfadeClips({
                clipAId: clipA.id,
                clipBId: clipB.id,
                replacement: action.payload.replacement,
            })
        );
    },
    describe: () => ({ label: 'Restore crossfade clips', inverseAction: null }),
    isNoop: (action) => {
        const clips = getTrackStoreState()?.tracks.flatMap((track) => track.clips) ?? [];
        const clipA = clips.find((clip) => clip.id === action.payload.clipAId);
        const clipB = clips.find((clip) => clip.id === action.payload.clipBId);
        if (!clipA || !clipB) {
            return false;
        }
        return snapshotsMatch({ left: readCrossfadeSnapshot({ clipA, clipB }), right: action.payload.replacement });
    },
    undoable: false,
});
