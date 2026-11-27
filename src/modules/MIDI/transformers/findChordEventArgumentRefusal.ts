import { MIN_CHORD_DURATION_BEATS } from '../models/ChordEvent';
import { CHORD_TYPES } from '../models/ChordTypes';

type ChordEventArguments = { beat: number; root: number; quality: string; duration?: number };

/** Why one new chord's values cannot be stored as given, or null when the track would hold them unchanged. */
export function findChordEventArgumentRefusal(values: ChordEventArguments): string | null {
    if (!Number.isFinite(values.beat) || values.beat < 0) {
        return `Chord beat must be a finite number of at least 0, got ${String(values.beat)}`;
    }
    if (!Number.isInteger(values.root) || values.root < 0 || values.root > 11) {
        return `Chord root must be an integer from 0 through 11, got ${String(values.root)}`;
    }
    if (!Object.hasOwn(CHORD_TYPES, values.quality)) {
        return `Chord quality "${String(values.quality)}" is not a known chord quality`;
    }
    if (
        values.duration !== undefined &&
        (!Number.isFinite(values.duration) || values.duration < MIN_CHORD_DURATION_BEATS)
    ) {
        return `Chord duration must be at least ${MIN_CHORD_DURATION_BEATS} beats, got ${String(values.duration)}`;
    }
    return null;
}
