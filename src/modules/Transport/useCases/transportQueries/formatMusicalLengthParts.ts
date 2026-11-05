import { type BarBeatSixteenthLength, formatBarBeatSixteenthLength } from '../../models/MusicalPositionFormat';

/** A measured length as `bars.beats.sixteenths`. */
export function formatMusicalLengthParts(parts: BarBeatSixteenthLength): string {
    return formatBarBeatSixteenthLength(parts);
}
