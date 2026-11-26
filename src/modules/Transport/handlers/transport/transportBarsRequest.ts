import { MAX_TRANSPORT_BARS, MIN_TRANSPORT_BARS } from '#/utils/transportBarsLimits';

/** A count-in or pre-roll spans whole bars inside the published range; nothing is rounded or clamped into it. */
export function isRequestableTransportBars(bars: number): boolean {
    return Number.isInteger(bars) && bars >= MIN_TRANSPORT_BARS && bars <= MAX_TRANSPORT_BARS;
}

export function transportBarsRefusalReason(bars: number): string | null {
    return isRequestableTransportBars(bars)
        ? null
        : `Bars must be a whole number from ${MIN_TRANSPORT_BARS} to ${MAX_TRANSPORT_BARS}`;
}
