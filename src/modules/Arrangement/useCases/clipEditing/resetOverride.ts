import { updateClip } from '../updateClip';

/**
 * Reset a local property override on a clip (H2).
 * The property will revert to the value defined in the parent/pooled clip.
 */
export function resetOverride(clipId: string, property: string): void {
    updateClip(clipId, (c) => {
        const nextOverrides = { ...c.overrides };
        delete nextOverrides[property];
        return { ...c, overrides: nextOverrides };
    });
}
