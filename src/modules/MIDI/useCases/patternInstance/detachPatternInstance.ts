import { updateClipInStore } from '#/modules/Arrangement/stores';

/**
 * Detach a pattern instance — break the link, making it independent.
 */
export function detachPatternInstance(clipId: string): void {
    updateClipInStore(clipId, (clip) => {
        if (!clip.parentClipId) {
            return clip;
        }
        const { parentClipId: _parent, overrides: _overrides, ...rest } = clip;
        return rest;
    });
}
