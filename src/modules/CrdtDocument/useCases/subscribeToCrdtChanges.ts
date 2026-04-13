import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Subscribe to CRDT document-change notifications.
 *
 * The returned function unsubscribes. Listeners are invoked after any
 * change is applied to any registered CRDT document. If the change
 * affected a single document, its `docId` is passed as a hint so
 * listeners can narrow per-doc work (§138.1); bulk operations
 * (load / merge / snapshot / createProject) pass `undefined`.
 */
export function subscribeToCrdtChanges(listener: (docId?: string) => void): () => void {
    return automergeRepository.onChange(listener);
}
