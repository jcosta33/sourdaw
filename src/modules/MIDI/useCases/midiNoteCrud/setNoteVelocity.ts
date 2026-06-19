import { updateNotesForClip } from './updateNotesForClip';

export function setNoteVelocity(clipId: string, noteId: string, velocity: number): void {
    // Clamp to the audible MIDI range [1, 127]. A velocity of 0 is a silent
    // note (effectively a note-off); enforcing the velocity >= 1 invariant here
    // keeps this in step with setAllVelocities/duplicateClipNotes.
    const clamped = Math.max(1, Math.min(127, velocity));
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => (node.id === noteId ? { ...node, velocity: clamped } : node))
    );
}
