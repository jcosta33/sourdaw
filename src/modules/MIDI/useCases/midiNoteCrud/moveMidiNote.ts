import { updateNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud/updateNotesForClip';

export function moveMidiNote(clipId: string, noteId: string, newPitch: number, newStartBeat: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => (n.id === noteId ? { ...n, pitch: newPitch, startBeat: newStartBeat } : n))
    );
}
