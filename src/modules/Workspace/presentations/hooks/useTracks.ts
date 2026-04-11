/**
 * useTracks — local re-implementation of Track/presentations/hooks/useTracks.
 * Uses the Track store (a contract) directly, avoiding cross-module hook import.
 */
import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';
import { type Track } from '../../models/TrackViewTypes';

type TrackListViewState = {
    tracks: Track[];
    selectedTrackId: string | null;
};

const defaultState: TrackListViewState = { tracks: [], selectedTrackId: null };

export const useTracks = (): { tracks: Track[]; selectedTrackId: string | null } => {
    const state = useStore<TrackListViewState>(trackStore, defaultState);

    return {
        tracks: state.tracks,
        selectedTrackId: state.selectedTrackId,
    };
};
