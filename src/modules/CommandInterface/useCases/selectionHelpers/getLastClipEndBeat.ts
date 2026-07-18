import { trackStore } from '#/modules/Arrangement/stores';

export function getLastClipEndBeat(): number {
    const state = trackStore.value;
    if (!state) {
        return 0;
    }
    let maxEnd = 0;
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.endBeat > maxEnd) {
                maxEnd = clip.endBeat;
            }
        }
    }
    return maxEnd;
}
