/**
 * useTracks — local re-implementation of Track/presentations/hooks/useTracks.
 * Uses the Track store (a contract) directly, avoiding cross-module hook import.
 */
import { useSyncExternalStore } from 'react';
import { trackStore, type TrackStoreState } from '#/modules/Track/stores/trackStore';

const defaultState: TrackStoreState = { tracks: [], selectedTrackId: null };

export const useTracks = (): { tracks: TrackStoreState['tracks']; selectedTrackId: string | null } => {
    const state = useSyncExternalStore(
        (onChange) => trackStore.subscribe(() => onChange()),
        () => trackStore.value ?? defaultState,
        () => trackStore.value ?? defaultState
    );

    return {
        tracks: state.tracks,
        selectedTrackId: state.selectedTrackId,
    };
};
