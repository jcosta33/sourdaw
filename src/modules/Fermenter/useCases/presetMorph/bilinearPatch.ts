import { type FermenterPatch } from '../../models/FermenterPatch';

import { lerpPatch } from './lerpPatch';

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
