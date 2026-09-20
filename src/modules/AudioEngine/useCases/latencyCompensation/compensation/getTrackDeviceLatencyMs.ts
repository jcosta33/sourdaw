import { type Track } from '#/modules/Arrangement/stores';

import { isLatencyCompensatedByEngine } from '../../livePlayback/isLatencyCompensatedByEngine';

import { getDeviceLatencyMs } from './getDeviceLatencyMs';
import { type LatencyCompensationInput } from './LatencyCompensationInput';

/** Count only processing the queried strip still owes outside the native engine. */
export function getTrackDeviceLatencyMs({
    track,
    omitDeviceTypes,
    hostedByEngine,
    input,
}: {
    track: Pick<Track, 'devices'>;
    omitDeviceTypes?: readonly string[];
    hostedByEngine: boolean;
    input?: LatencyCompensationInput;
}): number {
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
        if (input) {
            deviceLatencyMs += input.deviceLatencyMs.get(device.id) ?? 0;
        } else {
            deviceLatencyMs += getDeviceLatencyMs(device.id, device.type);
        }
    }

    return deviceLatencyMs;
}
