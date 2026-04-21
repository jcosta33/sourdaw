import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';

export function removeTrackFromVCA(trackId: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((time) => (time.id === trackId ? { ...time, vcaGroupId: null } : time)),
    });
}
