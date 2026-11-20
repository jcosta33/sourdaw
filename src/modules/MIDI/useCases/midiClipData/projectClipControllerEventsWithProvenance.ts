import { type MidiCC } from '../../models/MidiNote';
import { SAME_BEAT_TOLERANCE } from '../../models/SameBeatTolerance';

import { projectClipControllerEvents, type ProjectedClipControllerMove } from './projectClipControllerEvents';

export function projectClipControllerEventsWithProvenance(input: Parameters<typeof projectClipControllerEvents>[0]) {
    const source = new Map<string, MidiCC>();
    for (const row of input.controlChanges) {
        if (source.has(row.id)) {
            throw new Error('Ambiguous MIDI controller identity');
        }
        source.set(row.id, row);
    }
    const evidence: Array<
        ProjectedClipControllerMove & { sourceBeat: number; origin: 'source' | 'carried' | 'closing' }
    > = [];
    projectClipControllerEvents(input, (move, window) => {
        const original = source.get(move.id);
        if (!original) {
            throw new Error('MIDI controller source unavailable');
        }
        const sourceBeat = original.beat;
        let origin: 'source' | 'carried' | 'closing' = 'source';
        if (move.closesClip) {
            origin = 'closing';
        } else if (Math.abs(move.beat - window.beatOffset - sourceBeat) > SAME_BEAT_TOLERANCE) {
            origin = 'carried';
        }
        evidence.push({ ...move, sourceBeat, origin });
    });
    return evidence.sort((left, right) => left.beat - right.beat);
}
