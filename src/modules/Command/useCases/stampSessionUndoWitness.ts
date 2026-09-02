import { stampSessionUndoWitness as stampSessionUndoWitnessInStore } from '../stores/undoStore';

/**
 * Re-mirrors the live undo stacks against the current document witness.
 * CRDT persistence calls this immediately after it force-flushes its own
 * deferred writes and before it serializes bytes for IndexedDB, so the
 * witness this writes matches exactly what becomes durable. A no-op when the
 * live stacks carry no project/document owner.
 */
export function stampSessionUndoWitness(): void {
    stampSessionUndoWitnessInStore();
}
