import { formatBarBeatSixteenthLength } from '../../models/MusicalPositionFormat';

import { measureMusicalLength } from './measureMusicalLength';
import { type MeterInput } from './meterInput';

/** A span starting at `startBeat` as 0-based `bars.beats.sixteenths` of duration. */
export function formatMusicalLength(input: MeterInput & { startBeat: number; lengthBeats: number }): string {
    return formatBarBeatSixteenthLength(measureMusicalLength(input));
}
