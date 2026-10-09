import { shiftLoopOrigin } from '#/utils/clipLoopOrigin';
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
            // `historicalPlacement`: each `moved` names the clip's pre-gesture
            // host — a placement the document itself held, which the placement
            // rule may not have allowed. A replay that refuses it would strand
            // that clip on the wrong track while the restore reports written.
            moveClip(moved.clipId, moved.trackId, moved.startBeat, undefined, true, { historicalPlacement: true });
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
                    return {
                        ...clip,
                        startBeat: origin.origStartBeat,
                        endBeat: origin.origEndBeat,
                        // The recorded neighbors were relocated by the forward
                        // gesture's ripple; the undo reverses that relocation,
                        // so the loop anchor rides the same delta back (#4988).
                        loopOriginBeat: shiftLoopOrigin(clip, origin.origStartBeat - clip.startBeat),
                    };
                }),
            })),
        });
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore clip moves' }),
    undoable: false,
});
