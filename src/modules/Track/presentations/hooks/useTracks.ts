import { useSyncExternalStore } from 'react';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';

const defaultState: TrackStoreState = { tracks: [], selectedTrackId: null };

export const useTracks = () => {
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
