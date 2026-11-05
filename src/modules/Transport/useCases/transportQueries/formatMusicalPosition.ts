import { formatBarBeatSixteenth } from '../../models/musicalPositionFormat';

import { readMeterMap } from './readMeterMap';

/** A timeline beat as 1-based `bar.beat.sixteenth` through the project's meter map. */
export function formatMusicalPosition(beat: number): string {
    const { changes, defaults } = readMeterMap();
    return formatBarBeatSixteenth(changes, beat, defaults);
}
