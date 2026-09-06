import { createHandler } from '#/utils/createHandler';

import { moveClip } from '../../useCases/clip/moveClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { setTrackState } from '../../useCases/setTrackState';

/**
 * Guarded inverse of `moveClips`: restores every moved clip to its pre-gesture
 * placement, then restores the neighbors any ripple plan shifted back to their
 * recorded original positions across all tracks. Emitted only by the
 * `moveClips` handler — never invoked directly.
 */
export const handleRestoreClipMoves = createHandler<'restoreClipMoves'>({
    execute: (action) => {
        for (const moved of action.payload.movedClips) {
            moveClip(moved.clipId, moved.trackId, moved.startBeat);
        }
        const shifts = action.payload.neighborShifts;
        if (shifts.length === 0) {
            return { status: 'written' };
        }
        const state = getTrackStoreState();
        if (!state) {
            return { status: 'written' };
        }
        const shiftMap = new Map(shifts.map((shifted) => [shifted.clipId, shifted]));
        setTrackState({
            ...state,
            tracks: state.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => {
                    const origin = shiftMap.get(clip.id);
                    if (!origin) {
                        return clip;
                    }
                    return { ...clip, startBeat: origin.origStartBeat, endBeat: origin.origEndBeat };
                }),
            })),
        });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip moves' }),
    undoable: false,
});
