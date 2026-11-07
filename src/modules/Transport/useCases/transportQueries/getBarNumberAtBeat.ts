import { snapToSixteenthBoundary } from '../../models/MusicalPositionFormat';
import { getBarBeatAtPosition } from '../../models/TimeSignatureMap';

import { type MeterInput } from './meterInput';

/** The 1-based bar a timeline beat falls in, by the same law `formatMusicalPosition` prints. */
export function getBarNumberAtBeat({
    beat,
    changes,
    defaultNumerator,
    defaultDenominator,
}: MeterInput & { beat: number }): number {
    return getBarBeatAtPosition(changes, snapToSixteenthBoundary(beat), defaultNumerator, defaultDenominator).bar;
}
