import { mapAllTracks } from '#/modules/Arrangement/repositories/track/mapAllTracks';

export function ungroupTracks(groupId: string): void {
    mapAllTracks((t) => (t.groupId === groupId ? { ...t, groupId: null } : t));
}
