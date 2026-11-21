const MIN_BARS = 1;
const MAX_BARS = 8;

// Mirrors the clamp the setCountInBars and setPreRollBars use cases apply on write.
export function clampTransportBars(bars: number): number {
    return Math.max(MIN_BARS, Math.min(MAX_BARS, bars));
}
