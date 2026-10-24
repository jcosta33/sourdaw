import { resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

/**
 * The row shift a slip's raising wrap carries: the distance the wrapped phase
 * sits above the raw figure, or 0 when the wrap does not raise. Shared by the
 * forward pass (`slipClipContent`) and the handler's capture, so a recorded
 * inverse and the slip that produced it can never disagree about the lift.
 */
export function slipWrapRowLiftBeats(input: {
    loopEnabled: boolean;
    clipDurationBeats: number;
    configuredLoopLengthBeats: number | undefined;
    offsetBeats: number;
}): number {
    const phase = resolveLoopedOffsetBeats(input);
    return input.loopEnabled && phase > input.offsetBeats ? phase - input.offsetBeats : 0;
}
