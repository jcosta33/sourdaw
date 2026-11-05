import { measureBarBeatSixteenthLength } from '../../models/musicalPositionFormat';

import { type MeterInput } from './meterInput';

type MeasureInput = MeterInput & { startBeat: number; lengthBeats: number };

/** A span starting at `startBeat` as 0-based bars, beats and sixteenths of duration. */
export function measureMusicalLength({ startBeat, lengthBeats, changes, ...defaults }: MeasureInput) {
    return measureBarBeatSixteenthLength(changes, startBeat, lengthBeats, defaults);
}
