import { undoStore } from '../stores/undoStore';

export function clearUndoHistory(): void {
    undoStore.set({ past: [], future: [] });
}
