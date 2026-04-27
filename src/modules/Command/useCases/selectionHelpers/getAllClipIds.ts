import { trackStore } from '#/modules/Arrangement/stores';

export function getAllClipIds(): string[] {
    const state = trackStore.value;
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
