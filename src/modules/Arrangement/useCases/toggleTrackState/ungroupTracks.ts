import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function ungroupTracks(groupId: string): void {
    mapAllTracks((time) => (time.groupId === groupId ? { ...time, groupId: null } : time));
}
