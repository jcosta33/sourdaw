import { deepestHostedLatencyMs } from './deepestHostedLatencyMs';
import { getMaxTrackLatency } from './getMaxTrackLatency';
import { getTrackLatency } from './getTrackLatency';

/**
 * How long one strip waits before it plays, in seconds, so that it meets the
 * deepest strip in the session.
 *
 * `engineHostedStripIds` names the strips whose engine-compensated devices the
 * native engine hosts for this programme, and passing it switches the reading
 * from one strip to the native block as a whole. The engine runs its own
 * compensation pass over everything it carries and holds every native route
 * back to the deepest figure its own devices declare, so the natives are
 * already aligned among themselves at that depth D before this side adds
 * anything. All the programme has left to do is bring the whole block up to
 * the session's depth: it measures the session against the full device sum
 * every web scheduler also reads, subtracts what this side can still observe
 * on the strip, and subtracts D once because the engine has already spent it.
 * Web strips keep the default reader — no set — because nothing holds them but
 * their own worklets, and a gated-shut Bacteria's reported figure is exactly
 * what aligns such a strip against the native block.
 */
export function getCompensationDelay(
    trackId: string,
    omitDeviceTypes?: readonly string[],
    engineHostedStripIds?: ReadonlySet<string>
): number {
    // Session max stays live (including every device type, and every device the
    // engine hosts). Omit only shrinks the queried track's own loop so freeze
    // can pin the delay that matches a printed buffer that withheld those
    // types.
    const maxLatencyMs = getMaxTrackLatency();
    const trackLatency = getTrackLatency(trackId, new Set(), omitDeviceTypes, engineHostedStripIds);
    if (engineHostedStripIds === undefined) {
        return (maxLatencyMs - trackLatency.totalLatencyMs) / 1000;
    }
    const engineHoldMs = deepestHostedLatencyMs(engineHostedStripIds);
    return Math.max(0, maxLatencyMs - trackLatency.totalLatencyMs - engineHoldMs) / 1000;
}
