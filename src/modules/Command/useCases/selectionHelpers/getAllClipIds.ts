import { getTrackStoreState } from '#/modules/Arrangement/useCases';

export function getAllClipIds(): string[] {
    const state = getTrackStoreState();
    if (!state) {
        return [];
    }
    const ids: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            ids.push(clip.id);
        }
    }
    return ids;
}