import { getTrackState } from '../../repositories/track/getTrackState';
import { mapAllTracks } from '../../repositories/track/mapAllTracks';

export function groupTracks(trackIds: string[], _name: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }
    const groupId = `group-${Date.now()}`;
    mapAllTracks((t) => (trackIds.includes(t.id) ? { ...t, groupId } : t));
}
