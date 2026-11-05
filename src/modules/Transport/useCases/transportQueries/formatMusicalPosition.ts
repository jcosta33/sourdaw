import { formatBarBeatSixteenth } from '../../models/MusicalPositionFormat';

import { type MeterInput } from './meterInput';

/** A timeline beat as 1-based `bar.beat.sixteenth` through the given meter map. */
export function formatMusicalPosition({ beat, changes, ...defaults }: MeterInput & { beat: number }): string {
    return formatBarBeatSixteenth(changes, beat, defaults);
}
