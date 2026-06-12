import { undoStore } from './undoStore';

export function clearUndoHistory(): void {
    undoStore.set({ past: [], future: [] });
}
