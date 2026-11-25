import { MAX_TRANSPORT_BARS, MIN_TRANSPORT_BARS } from '#/utils/transportBarsLimits';

// Mirrors the clamp the setCountInBars and setPreRollBars use cases apply on write.
export function clampTransportBars(bars: number): number {
    return Math.max(MIN_TRANSPORT_BARS, Math.min(MAX_TRANSPORT_BARS, bars));
}
