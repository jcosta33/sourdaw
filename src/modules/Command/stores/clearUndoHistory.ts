import { clearUndoStoreOwner, undoStore } from './undoStore';

/**
 * Drops the live stacks and their project/document tag together. Every
 * in-session project transition (new project, template, arrangement switch,
 * branch switch) calls this: dropping the tag too keeps a later mirror flush
 * from attributing untouched stacks to the project it just left. See
 * `Command/AGENTS.md` for the accepted incompleteness this trades for safety.
 */
export function clearUndoHistory(): void {
    clearUndoStoreOwner();
    undoStore.set({ past: [], future: [] });
}
