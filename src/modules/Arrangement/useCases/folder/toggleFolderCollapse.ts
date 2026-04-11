import { updateTrack } from '../../repositories/track/updateTrack';

export function toggleFolderCollapse(folderId: string): void {
    updateTrack(folderId, (t) => ({ ...t, collapsed: !t.collapsed }));
}