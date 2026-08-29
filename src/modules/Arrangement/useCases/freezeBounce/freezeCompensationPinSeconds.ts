/**
 * Latency the freeze pin must carry after the offline print.
 *
 * The print already bakes live PDC into clip placement. Pin only the gap
 * between the omit-list figure and live delay (plugin/bridge residual), never
 * the full omitted figure — that would double-apply live PDC on playback.
 */
export function freezeCompensationPinSeconds(liveDelay: number, omittedDelay: number): number {
    return Math.max(0, omittedDelay - liveDelay);
}
