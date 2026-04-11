import { updateClip } from '#/modules/Arrangement/useCases';

/**
 * Detach a pattern instance — break the link, making it independent.
 */
export function detachPatternInstance(clipId: string): void {
    updateClip(clipId, (c) => {
        if (!c.parentClipId) {
            return c;
        }
        const { parentClipId: _, overrides: __, ...rest } = c;
        return rest;
    });
}