/** A collapsed scratch pad shows only its header strip. */
export const SCRATCH_PAD_COLLAPSED_HEIGHT = 30;

/** Height the scratch pad renders at, given whether it is collapsed and its requested height. */
export function getScratchPadRenderedHeight(collapsed: boolean, requestedHeight: number): number {
    return collapsed ? SCRATCH_PAD_COLLAPSED_HEIGHT : requestedHeight;
}
