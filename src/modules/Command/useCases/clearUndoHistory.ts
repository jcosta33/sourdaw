import { inject } from '#/infra/di/inject';
import { undoStore } from '../stores/undoStore';

/**
 * Clear the undo/redo history.
 *
 * Used by Project load/save flows when the document state is replaced and
 * historical actions no longer reference valid IDs. The mutation lives here
 * (in Command, the owning module of `undoStore`) so other modules can call
 * the operation without reaching into Command's stores directly.
 */
export const clearUndoHistory = inject({ undoStore })(({ undoStore: store }) => {
    return function clearUndoHistory(): void {
        store.set({ past: [], future: [] });
    };
});
