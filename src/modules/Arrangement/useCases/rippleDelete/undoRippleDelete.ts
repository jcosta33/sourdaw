import { inject } from '#/infra/di/inject';
import { type Clip } from '../../stores/trackStore';
import { getTrackStoreState } from '../getTrackStoreState';
import { setTrackState } from '../setTrackState';

type RippleDeleteShift = {
    clipId: string;
    origStartBeat: number;
    origEndBeat: number;
};

type UndoRippleDeleteInput = {
    trackId: string;
    removedClips: Clip[];
    shiftedClips: RippleDeleteShift[];
};

export const undoRippleDelete = inject({ getTrackStoreState, setTrackState })(
    ({ getTrackStoreState, setTrackState }) =>
        function undoRippleDelete({ trackId, removedClips, shiftedClips }: UndoRippleDeleteInput): void {
            const state = getTrackStoreState();
            if (!state) {
                return;
            }

            const shiftMap = new Map(shiftedClips.map((shift) => [shift.clipId, shift]));

            setTrackState({
                ...state,
                tracks: state.tracks.map((track) => {
                    if (track.id !== trackId) {
                        return track;
                    }

                    const restoredClips = track.clips.map((clip) => {
                        const originalShift = shiftMap.get(clip.id);
                        if (!originalShift) {
                            return clip;
                        }

                        return {
                            ...clip,
                            startBeat: originalShift.origStartBeat,
                            endBeat: originalShift.origEndBeat,
                        };
                    });

                    return {
                        ...track,
                        clips: [...restoredClips, ...removedClips],
                    };
                }),
            });
        }
);
