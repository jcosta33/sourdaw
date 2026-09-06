import { audioEngine } from '../../repositories/createWebAudioEngine';
import { readNativeEngineMasterPeak } from '../livePlayback/readNativeEngineMasterPeak';

/**
 * Linear master peak, or `null` when nothing measured the output.
 *
 * Two carriers can reach the device at once. The native live session sounds
 * every strip the carrier law hands it, and Web Audio sounds the rest, and
 * there is no node anywhere in the app where the two sums meet — the summing
 * happens in the device. So the Out meter shows the louder of the two: the
 * quieter carrier is never the peak the device saw, and taking only one side
 * would drop a strip's level off the readout entirely the moment the carrier
 * law moved it across.
 *
 * `null` keeps its meaning of "nobody measured": Web Audio with no meter tap
 * and no audible native session. A measured zero is a level, and reports as
 * one.
 */
export function getMasterPeakLevel(): number | null {
    const web = audioEngine.getMasterPeakLevel();
    const native = readNativeEngineMasterPeak();
    if (native === null) {
        return web;
    }
    return web === null ? native : Math.max(web, native);
}
