import { useStore } from '#/infra/store/useStore';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';

const defaultState: TrackStoreState = { tracks: [], selectedTrackId: null };

export const useTracks = (): { tracks: TrackStoreState['tracks']; selectedTrackId: string | null } => {
    const state = useStore(trackStore, defaultState);

    return {
        tracks: state.tracks,
        selectedTrackId: state.selectedTrackId,
    };
};
