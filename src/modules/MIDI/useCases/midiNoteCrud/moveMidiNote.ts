import { updateNotesForClip } from './updateNotesForClip';

export function moveMidiNote(clipId: string, noteId: string, newPitch: number, newStartBeat: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) => (node.id === noteId ? { ...node, pitch: newPitch, startBeat: newStartBeat } : node))
    );
}
