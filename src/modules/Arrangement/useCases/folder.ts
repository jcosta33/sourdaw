import { getTrackState, setTrackState, updateTrack } from '../repositories/track';
import { createTrack } from '../models/Track';

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

export function toggleFolderCollapse(folderId: string): void {
    updateTrack(folderId, (t) => ({ ...t, collapsed: !t.collapsed }));
}
