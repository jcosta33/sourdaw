import { updateNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud/updateNotesForClip';

export function setNoteProbability(clipId: string, noteId: string, probability: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => (n.id === noteId ? { ...n, probability: Math.max(0, Math.min(100, probability)) } : n))
    );
}
