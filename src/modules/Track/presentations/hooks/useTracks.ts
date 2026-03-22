import { useSyncExternalStore } from 'react';
import { trackStore, type TrackStoreState } from '../../stores/trackStore';

const defaultState: TrackStoreState = { tracks: [], selectedTrackId: null };

const subscribe = (onChange: () => void): (() => void) => trackStore.subscribe(() => onChange());
const getSnapshot = (): TrackStoreState => trackStore.value ?? defaultState;

export const useTracks = (): { tracks: TrackStoreState['tracks']; selectedTrackId: string | null } => {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

    return {
        tracks: state.tracks,
        selectedTrackId: state.selectedTrackId,
    };
};
