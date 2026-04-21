import { updateTrack } from '../../repositories/track/updateTrack';

export function toggleFolderCollapse(folderId: string): void {
    updateTrack(folderId, (time) => ({ ...time, collapsed: !time.collapsed }));
}
