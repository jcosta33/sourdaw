/**
 * Preset morphing — smoothly interpolate between two FermenterPatch states.
 * Used by the Transform Pad for 4-corner interpolation and by the A/B compare feature.
 */

import { type FermenterPatch } from '../models/FermenterPatch';
import { loadFermenterPatch } from '../stores/fermenterStore';
import { setFermenterParamWithAudio } from './fermenterParamBridge';

/**
 * Linearly interpolate between two patches.
 * Non-numeric fields (name, version) come from patch A.
 * Numeric fields are lerped by t (0=A, 1=B).
 */
export function lerpPatch(a: FermenterPatch, b: FermenterPatch, t: number): FermenterPatch {
    const clamped = Math.max(0, Math.min(1, t));
    const result = { ...a };

    for (const key of Object.keys(a) as Array<keyof FermenterPatch>) {
        const va = a[key];
        const vb = b[key];
        if (typeof va === 'number' && typeof vb === 'number') {
            (result as Record<string, unknown>)[key] = va + (vb - va) * clamped;
        }
    }

    result.name = clamped < 0.5 ? a.name : b.name;
    return result;
}

/**
 * Bilinear interpolation for 4-corner Transform Pad.
 * Corners: TL (top-left), TR, BL, BR.
 * x: 0=left, 1=right. y: 0=top, 1=bottom.
 */
export function bilinearPatch(
    tl: FermenterPatch,
    tr: FermenterPatch,
    bl: FermenterPatch,
    br: FermenterPatch,
    x: number,
    y: number,
): FermenterPatch {
    const top = lerpPatch(tl, tr, x);
    const bottom = lerpPatch(bl, br, x);
    return lerpPatch(top, bottom, y);
}

/**
 * Apply a morphed patch — updates both the store and the audio engine.
 */
export function applyMorphedPatch(patch: FermenterPatch): void {
    loadFermenterPatch(patch);
    for (const [key, val] of Object.entries(patch)) {
        if (typeof val === 'number') {
            setFermenterParamWithAudio(key as keyof FermenterPatch, val);
        }
    }
}
