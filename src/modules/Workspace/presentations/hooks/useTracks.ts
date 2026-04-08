/**
 * useTracks — local re-implementation of Track/presentations/hooks/useTracks.
 * Uses the Track store (a contract) directly, avoiding cross-module hook import.
 */
import { useStore } from '#/infra/store/useStore';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement';

const defaultState: TrackStoreState = { tracks: [], selectedTrackId: null };

export const useTracks = (): { tracks: TrackStoreState['tracks']; selectedTrackId: string | null } => {
    const state = useStore(trackStore, defaultState);

    return {
        tracks: state.tracks,
        selectedTrackId: state.selectedTrackId,
    };
};
