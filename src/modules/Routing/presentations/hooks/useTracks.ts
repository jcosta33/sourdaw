/**
 * useTracks — Routing-local read of the Arrangement track store (a contract),
 * mirroring Workspace's hook so the routing views avoid a cross-module hook
 * import while keeping their own narrow view type.
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
