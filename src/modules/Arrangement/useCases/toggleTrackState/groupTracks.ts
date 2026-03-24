import { getTrackState, mapAllTracks } from '#/modules/Arrangement/repositories/trackRepository';

export function groupTracks(trackIds: string[], _name: string): void {
    const state = getTrackState();
    if (!state) {
        return;
    }
    const groupId = `group-${Date.now()}`;
    mapAllTracks((t) => (trackIds.includes(t.id) ? { ...t, groupId } : t));
}
