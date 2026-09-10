import { getMaxTrackLatency } from './getMaxTrackLatency';
import { getTrackLatency } from './getTrackLatency';

/**
 * How long one strip waits before it plays, in seconds, so that it meets the
 * deepest strip in the session.
 *
 * `engineHostedStripIds` names the strips the native engine carries, and it
 * reaches both readings below — see [getTrackLatency] for why it travels where
 * `omitDeviceTypes` deliberately does not.
 */
export function getCompensationDelay(
    trackId: string,
    omitDeviceTypes?: readonly string[],
    engineHostedStripIds?: ReadonlySet<string>
): number {
    // Session max stays live (including every device type). Omit only shrinks
    // the queried track's own loop so freeze can pin the delay that matches a
    // printed buffer that withheld those types.
    const maxLatencyMs = getMaxTrackLatency(engineHostedStripIds);
    const trackLatency = getTrackLatency(trackId, new Set(), omitDeviceTypes, engineHostedStripIds);
    return (maxLatencyMs - trackLatency.totalLatencyMs) / 1000;
}
