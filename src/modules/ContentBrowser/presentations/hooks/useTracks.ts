/**
 * useTracks — ContentBrowser-local re-implementation reading Arrangement's
 * track store (a public contract) directly, avoiding a cross-module hook import.
 * Mirrors the per-module `useTracks` duplication pattern used across the app.
 */
import { useStore } from '#/infra/store/useStore';
import { trackStore, type Track } from '#/modules/Arrangement/stores';

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
