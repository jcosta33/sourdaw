import { SIXTEENTHS_PER_QUARTER, snapToSixteenthBoundary } from '../../models/MusicalPositionFormat';

import { getBarNumberAtBeat } from './getBarNumberAtBeat';
import { type MeterInput } from './meterInput';

/**
 * The 1-based bar holding the last sixteenth that starts before `beat`: the bar an end-exclusive
 * range ending at `beat` last reaches, so a range ending on a bar line stops in the bar before it.
 */
export function getLastBarNumberBeforeBeat({ beat, ...meter }: MeterInput & { beat: number }): number {
    const endSixteenth = Math.ceil(snapToSixteenthBoundary(beat) * SIXTEENTHS_PER_QUARTER);
    return getBarNumberAtBeat({ ...meter, beat: (endSixteenth - 1) / SIXTEENTHS_PER_QUARTER });
}
