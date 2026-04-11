import { getTrackStoreState } from '#/modules/Arrangement/useCases';

export function getLastClipEndBeat(): number {
    const state = getTrackStoreState();
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