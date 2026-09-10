/**
 * The strips whose own latency the native engine compensates for them (#4153).
 *
 * A device the engine holds its strip back by must not be counted a second
 * time in the renderer's compensation sum, and both conditions have to hold
 * for one strip before it can be excluded: the engine has to be the carrier
 * that sounds it, and its chain has to hold a device the engine declares a
 * latency for. A web-carried strip keeps counting every device it holds,
 * because what aligns it there is its own worklet's reported figure.
 *
 * An empty answer therefore means the sum needs no exclusion at all, which is
 * every session holding no engine-compensated body.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { isLatencyCompensatedByEngine } from './isLatencyCompensatedByEngine';
import { type StripCarrier } from './stripCarriers';

export function engineHostedStripIds(
    carriers: ReadonlyMap<string, StripCarrier>,
    stripTracks: readonly Track[]
): ReadonlySet<string> {
    const hosted = new Set<string>();
    for (const track of stripTracks) {
        if (carriers.get(track.id)?.carrier !== 'native') {
            continue;
        }
        if (track.devices.some((device) => isLatencyCompensatedByEngine(device.type))) {
            hosted.add(track.id);
        }
    }
    return hosted;
}
