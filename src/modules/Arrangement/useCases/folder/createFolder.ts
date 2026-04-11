import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { createTrack } from '../../models/Track';

export function createFolder(name: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const folder = createTrack({ name, kind: 'folder' });
    setTrackState({
        ...state,
        tracks: [...state.tracks, folder],
    });
}