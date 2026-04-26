import { updateClip } from '../updateClip';

/**
 * Reset a local property override on a clip (H2).
 * The property will revert to the value defined in the parent/pooled clip.
 */
export function resetOverride(clipId: string, property: string): void {
    updateClip(clipId, (context) => {
        const nextOverrides = { ...context.overrides };
        delete nextOverrides[property];
        return { ...context, overrides: nextOverrides };
    });
}
