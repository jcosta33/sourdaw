import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { trackStore } from '../../stores/trackStore';
import { updateClipInStore } from '../../stores/updateClipInStore';

/**
 * Detach a pattern instance — break the link, making it independent.
 */
export function detachPatternInstance(clipId: string): boolean {
    const target = resolveEligibleClipWriteTarget({ clipId });
    if (target.status !== 'eligible' || !('clipId' in target)) {
        return false;
    }

    const state = trackStore.value;
    if (!state) {
        return false;
    }

    const owner = state.tracks.find((track) => track.id === target.trackId);
    const clip = owner?.clips.find((candidate) => candidate.id === target.clipId);
    if (!clip || typeof clip.parentClipId !== 'string' || clip.parentClipId.length === 0) {
        return false;
    }

    return updateClipInStore(target.clipId, (currentClip) => {
        const { parentClipId: _parent, overrides: _overrides, ...rest } = currentClip;
        return rest;
    });
}
