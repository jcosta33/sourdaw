import { updateClip } from '#/modules/Arrangement/useCases';

/**
 * Detach a pattern instance — break the link, making it independent.
 */
export function detachPatternInstance(clipId: string): void {
    updateClip(clipId, (context) => {
        if (!context.parentClipId) {
            return context;
        }
        const { parentClipId: _, overrides: __, ...rest } = context;
        return rest;
    });
}
