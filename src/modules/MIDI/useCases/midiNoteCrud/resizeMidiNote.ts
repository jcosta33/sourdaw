import { updateNotesForClip } from './updateNotesForClip';

export function resizeMidiNote(clipId: string, noteId: string, newStartBeat?: number, newDuration?: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => {
            if (node.id !== noteId) {
                return node;
            }
            return {
                ...node,
                startBeat: newStartBeat !== undefined ? newStartBeat : node.startBeat,
                duration: newDuration !== undefined ? Math.max(0.0625, newDuration) : node.duration,
            };
        })
    );
}
