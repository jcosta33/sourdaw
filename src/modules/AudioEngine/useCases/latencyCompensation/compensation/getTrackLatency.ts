import { trackStore } from '#/modules/Arrangement/stores';
import { sidechainStore } from '#/modules/Routing/stores';

import { type TrackLatency } from '../../../models/LatencyCompensationTypes';
import { isLatencyCompensatedByEngine } from '../../livePlayback/isLatencyCompensatedByEngine';

import { getDeviceLatencyMs } from './getDeviceLatencyMs';

/**
 * What one strip's signal has waited by the time it reaches the mix, in
 * milliseconds.
 *
 * `engineHostedStripIds` names the strips whose engine-compensated devices the
 * native engine hosts. It is not a second `omitDeviceTypes`: omit is a
 * statement about one queried track, because freeze printed that chain without
 * those types while the buses under it were printed with theirs, so it
 * deliberately stops at the first hop. Engine hosting is a statement about the
 * route — a device the engine compensates delays nothing this side can observe,
 * on whichever hop of the route it sits — so the set travels down every
 * recursive call, the way `external-plugin` reads as zero everywhere. What it
 * does not reach is the session maximum: see [getCompensationDelay] for why the
 * native block is aimed at the full session depth rather than a shrunken one.
 */
export function getTrackLatency(
    trackId: string,
    visited = new Set<string>(),
    omitDeviceTypes?: readonly string[],
    engineHostedStripIds?: ReadonlySet<string>
): TrackLatency {
    const state = trackStore.value;
    if (!state) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    const track = state.tracks.find((time) => time.id === trackId);
    if (!track || visited.has(trackId)) {
        return { trackId, deviceLatencyMs: 0, totalLatencyMs: 0 };
    }

    visited.add(trackId);

    const hostedByEngine = engineHostedStripIds?.has(trackId) === true;

    let deviceLatencyMs = 0;
    for (const device of track.devices) {
        if (device.bypassed) {
            continue;
        }
        // Omit applies only to this queried track's own device loop — never to
        // recursive downstream (output/sends/sidechain) totals. Freeze printed
        // this track's chain without those types; buses below were not printed.
        if (omitDeviceTypes?.includes(device.type)) {
            continue;
        }
        // A device the native engine compensates itself where it carries the
        // strip delays nothing this side can see, exactly like an
        // `external-plugin`: the engine holds every route meeting that strip
        // back by the device's own figure, so counting it here would count it
        // twice.
        if (hostedByEngine && isLatencyCompensatedByEngine(device.type)) {
            continue;
        }
        deviceLatencyMs += getDeviceLatencyMs(device.id, device.type);
    }

    let maxDownstreamMs = 0;

    if (track.outputId && track.outputId !== 'hw_out') {
        const outLatency = getTrackLatency(track.outputId, visited, undefined, engineHostedStripIds);
        maxDownstreamMs = Math.max(maxDownstreamMs, outLatency.totalLatencyMs);
    }

    for (const send of track.sends) {
        const sendLatency = getTrackLatency(send.busId, visited, undefined, engineHostedStripIds);
        maxDownstreamMs = Math.max(maxDownstreamMs, sendLatency.totalLatencyMs);
    }

    // Sidechain routes feed this track's signal into a downstream target's
    // sidechain input (source -> target, mirroring sends/output). The target's
    // processing latency is therefore downstream of this track and must be
    // folded in, or PDC drifts on sidechain pumping mixes.
    const sidechainRoutes = sidechainStore.value?.routes ?? [];
    for (const route of sidechainRoutes) {
        if (route.sourceTrackId !== trackId) {
            continue;
        }
        const targetLatency = getTrackLatency(route.targetTrackId, visited, undefined, engineHostedStripIds);
        maxDownstreamMs = Math.max(maxDownstreamMs, targetLatency.totalLatencyMs);
    }

    visited.delete(trackId);

    return { trackId, deviceLatencyMs, totalLatencyMs: deviceLatencyMs + maxDownstreamMs };
}
