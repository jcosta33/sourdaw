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
        } else if (Array.isArray(va) && Array.isArray(vb) && va.length === vb.length) {
            // Assume number array (e.g. macros)
            const arr = Array.from({ length: va.length });
            for (let i = 0; i < va.length; i++) {
                const aVal = va[i];
                const bVal = vb[i];
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    arr[i] = aVal + (bVal - aVal) * clamped;
                } else {
                    arr[i] = aVal; // Fallback to A if not numbers
                }
            }
            (result as Record<string, unknown>)[key] = arr;
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
