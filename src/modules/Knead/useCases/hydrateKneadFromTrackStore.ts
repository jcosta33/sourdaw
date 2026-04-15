import { kneadStore } from '../stores/kneadStore';
import { trackStore } from '#/modules/Arrangement/stores';

/**
 * Hydrates the kneadStore with pitch-correction data extracted from
 * the clips in the trackStore.
 */
export function hydrateKneadFromTrackStore(): void {
    const trackStoreValue = trackStore.value;
    if (!trackStoreValue) {return;}

    const { tracks } = trackStoreValue;
    const clipsWithKnead: Record<string, any> = {};

    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.kneadState) {
                clipsWithKnead[clip.id] = clip.kneadState;
            }
        }
    }

    const currentKnead = kneadStore.value;
    if (currentKnead) {
        kneadStore.set({
            ...currentKnead,
            clips: clipsWithKnead,
        });
    }
}
