import { formatBarBeatSixteenthLength } from '../../models/musicalPositionFormat';

import { readMeterMap } from './readMeterMap';

/** A span starting at `startBeat` as 0-based `bars.beats.sixteenths` of duration. */
export function formatMusicalLength(startBeat: number, lengthBeats: number): string {
    const { changes, defaults } = readMeterMap();
    return formatBarBeatSixteenthLength(changes, startBeat, lengthBeats, defaults);
}
