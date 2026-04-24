import { updateClipInStore } from '#/modules/Arrangement/stores';

/**
 * Detach a pattern instance — break the link, making it independent.
 */
export function detachPatternInstance(clipId: string): void {
    updateClipInStore(clipId, (c) => {
        if (!c.parentClipId) {
            return c;
        }
        const { parentClipId: _parent, overrides: _overrides, ...rest } = c;
        return rest;
    });
}
