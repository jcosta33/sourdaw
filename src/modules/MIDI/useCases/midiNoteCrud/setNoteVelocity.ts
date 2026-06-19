import { updateNotesForClip } from './updateNotesForClip';

export function setNoteVelocity(clipId: string, noteId: string, velocity: number): void {
    // Clamp to the audible MIDI range [1, 127] and round to an integer: MIDI
    // velocity is a 7-bit integer, so a fractional input must collapse to a
    // whole step. A velocity of 0 is a silent note (effectively a note-off);
    // enforcing the velocity >= 1 invariant here keeps this in step with
    // addMidiNote/batchAddMidiNotes/duplicateClipNotes/stampChord.
    const clamped = Math.round(Math.max(1, Math.min(127, velocity)));
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => (node.id === noteId ? { ...node, velocity: clamped } : node))
    );
}
