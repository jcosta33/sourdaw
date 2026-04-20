import { getTimeSignatureAtBeat as getAtBeat } from '../../models/TimeSignatureMap';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

/**
 * Get the time signature (numerator/denominator) at a specific beat.
 * R-H3: Used for rendering and scheduling.
 */
export function getTimeSignatureAtBeat(beat: number): { numerator: number; denominator: number } {
    const state = timeSignatureMapStore.value;
    const changes = state?.changes ?? [];
    return getAtBeat(changes, beat, 4, 4);
}
