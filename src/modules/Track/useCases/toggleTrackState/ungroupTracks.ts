import { mapAllTracks } from '#/modules/Track/repositories/trackRepository';

export function ungroupTracks(groupId: string): void {
    mapAllTracks((t) => (t.groupId === groupId ? { ...t, groupId: null } : t));
}
