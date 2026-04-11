import { getTrackStoreState } from '#/modules/Arrangement/useCases';

/**
 * Get all instance clip IDs linked to a parent.
 */
export function getPatternInstances(parentClipId: string): string[] {
    const state = getTrackStoreState();
    if (!state) {
        return [];
    }

    const instances: string[] = [];
    for (const track of state.tracks) {
        for (const clip of track.clips) {
            if (clip.parentClipId === parentClipId) {
                instances.push(clip.id);
            }
        }
    }
    return instances;
}