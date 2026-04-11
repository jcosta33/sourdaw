import { type FermenterPatch } from '../../models/FermenterPatch';

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
    y: number
): FermenterPatch {
    const top = lerpPatch(tl, tr, x);
    const bottom = lerpPatch(bl, br, x);
    return lerpPatch(top, bottom, y);
}