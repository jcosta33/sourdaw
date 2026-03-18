import { getTrackState, setTrackState, updateTrack, getAllTracks } from '../repositories/trackRepository';
import { createTrack, type Track } from '../models/Track';

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

export function moveToFolder(trackId: string, folderId: string | null): void {
    updateTrack(trackId, (t) => ({ ...t, parentId: folderId }));
}

export function toggleFolderCollapse(folderId: string): void {
    updateTrack(folderId, (t) => ({ ...t, collapsed: !t.collapsed }));
}

export function getVisibleTracks(): Track[] {
    const tracks = getAllTracks();

    const collapsedFolders = new Set(tracks.filter((t) => t.kind === 'folder' && t.collapsed).map((t) => t.id));

    return tracks.filter((t) => {
        if (!t.parentId) {
            return true;
        }
        return !collapsedFolders.has(t.parentId);
    });
}
