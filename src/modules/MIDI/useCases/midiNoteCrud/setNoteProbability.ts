import { updateNotesForClip } from './updateNotesForClip';

export function setNoteProbability(clipId: string, noteId: string, probability: number): void {
    updateNotesForClip(clipId, (notes) =>
        notes.map((node) =>
            node.id === noteId ? { ...node, probability: Math.max(0, Math.min(100, probability)) } : node
        )
    );
}
