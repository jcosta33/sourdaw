/**
 * The strips whose own engine-compensated devices the native engine holds back
 * for them (#4153).
 *
 * A device the engine holds its strip back by must not be counted a second
 * time in the renderer's compensation sum, and the strip has to be one the
 * engine really runs: the engine has to be the carrier that sounds it, and its
 * chain has to hold a device the engine declares a latency for. A web-carried
 * strip keeps counting every device it holds, because what aligns it there is
 * its own worklet's reported figure.
 *
 * Buses are read differently, because `projectStripCarriers` gives them no
 * carrier entry at all: a bus twin is built natively whenever the engine
 * carries any track, so a bus holding a compensated device is the engine's
 * exactly when at least one track is. Leaving buses out would understate the
 * hold the engine takes on every route passing through such a bus, and every
 * native strip beside that route would then be delayed twice by it.
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
    const anyNativeTrack = stripTracks.some(
        (track) => track.kind !== 'bus' && carriers.get(track.id)?.carrier === 'native'
    );
    const hosted = new Set<string>();
    for (const track of stripTracks) {
        const carriedByEngine = track.kind === 'bus' ? anyNativeTrack : carriers.get(track.id)?.carrier === 'native';
        if (!carriedByEngine) {
            continue;
        }
        if (track.devices.some((device) => isLatencyCompensatedByEngine(device.type))) {
            hosted.add(track.id);
        }
    }
    return hosted;
}
