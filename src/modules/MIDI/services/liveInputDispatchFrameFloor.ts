/**
 * The latest frame a live input event was dispatched at, per `AudioContext`.
 *
 * It lives here rather than beside `resolveInputDispatchFrame` because a
 * use-case file exports exactly one function
 * (`sourdaw/no-multiple-function-exports`), which leaves module state there
 * with nothing to clear it — and a floor a spec cannot clear carries one
 * spec's frames into the next.
 */
let floorContext: object | null = null;
let floorFrame = Number.NEGATIVE_INFINITY;

/**
 * Raise `frame` to the latest frame already dispatched for this context.
 *
 * Live controllers are applied in frame order, so an older event must never
 * receive a later frame than a newer one — which the arrival-time fallback to
 * "now" after a main-thread stall would otherwise allow. A different context
 * has its own clock, so the floor starts over.
 */
export function raiseToLiveInputDispatchFrameFloor(context: object, frame: number): number {
    if (context !== floorContext) {
        floorContext = context;
        floorFrame = Number.NEGATIVE_INFINITY;
    }
    floorFrame = Math.max(floorFrame, frame);
    return floorFrame;
}

/** Forget the floor, so the next frame is taken as it comes. */
export function resetLiveInputDispatchFrameFloor(): void {
    floorContext = null;
    floorFrame = Number.NEGATIVE_INFINITY;
}
