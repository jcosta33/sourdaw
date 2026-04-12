import { updateNotesForClip } from '#/modules/MIDI/useCases/midiNoteCrud/updateNotesForClip';

export function resizeMidiNote(clipId: string, noteId: string, newStartBeat?: number, newDuration?: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((n) => {
            if (n.id !== noteId) {
                return n;
            }
            return {
                ...n,
                startBeat: newStartBeat !== undefined ? newStartBeat : n.startBeat,
                duration: newDuration !== undefined ? Math.max(0.125, newDuration) : n.duration,
            };
        })
    );
}
