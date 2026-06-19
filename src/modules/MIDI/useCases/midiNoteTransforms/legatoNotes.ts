import { type MidiNote } from '../../models/MidiNote';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

/** Minimum legato note length: a 1/64 note. */
const MIN_DURATION = 0.0625;

/**
 * Extends or contracts each selected note's duration so its end meets
 * the start of the next note on the same pitch (R-A4).
 *
 * Fallback: if no subsequent note exists on the same pitch, extends to the
 * start of the next note on *any* pitch in the clip — including unselected
 * notes. Stopping only at selected notes used to skip over unselected notes
 * sitting in between, overrunning them and distorting chord voicings.
 *
 * Notes that have no subsequent note (same or any pitch) are left unchanged.
 *
 * Both "next note on same pitch" and "next note on any pitch" are precomputed in
 * a single sorted pass, so the whole transform is O(N log N) rather than scanning
 * the entire note array twice per selected note (O(N·S)).
 */
export function legatoNotes(clipId: string, selectedIds: string[]): void {
    if (selectedIds.length === 0) {
        return;
    }
    const idSet = new Set(selectedIds);

    updateNotesForClip(clipId, (notes) => {
        // Sort indices by startBeat (ties broken by original order) so we can walk
        // from latest to earliest and remember the nearest later start beat.
        const order = notes.map((_, index) => index);
        order.sort((alpha, beta) => {
            const delta = notes[alpha]!.startBeat - notes[beta]!.startBeat;
            return delta !== 0 ? delta : alpha - beta;
        });

        // nextAnyStart[i]   = start beat of the next note (any pitch) strictly after note i
        // nextSamePitch[i]  = start beat of the next note on note i's pitch strictly after it
        const nextAnyStart = Array.from<number | null>({ length: notes.length }).fill(null);
        const nextSamePitchStart = Array.from<number | null>({ length: notes.length }).fill(null);

        let nearestLaterStart: number | null = null;
        const nearestLaterByPitch = new Map<number, number>();

        for (let rank = order.length - 1; rank >= 0; rank--) {
            const index = order[rank]!;
            const note = notes[index]!;

            // A candidate counts only if its start is strictly greater (skip same-start ties).
            if (nearestLaterStart !== null && nearestLaterStart > note.startBeat) {
                nextAnyStart[index] = nearestLaterStart;
            }
            const samePitch = nearestLaterByPitch.get(note.pitch);
            if (samePitch !== undefined && samePitch > note.startBeat) {
                nextSamePitchStart[index] = samePitch;
            }

            // This note is now the nearest later start for everything before it.
            if (nearestLaterStart === null || note.startBeat < nearestLaterStart) {
                nearestLaterStart = note.startBeat;
            }
            const existingPitch = nearestLaterByPitch.get(note.pitch);
            if (existingPitch === undefined || note.startBeat < existingPitch) {
                nearestLaterByPitch.set(note.pitch, note.startBeat);
            }
        }

        return notes.map((note: MidiNote, index) => {
            if (!idSet.has(note.id)) {
                return note;
            }

            const targetEnd = nextSamePitchStart[index] ?? nextAnyStart[index];
            if (targetEnd === null || targetEnd === undefined) {
                return note;
            }

            const newDuration = Math.max(MIN_DURATION, targetEnd - note.startBeat);
            return { ...note, duration: newDuration };
        });
    });
}
