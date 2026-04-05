import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Subscribe to CRDT document-change notifications.
 *
 * The returned function unsubscribes. Listeners are invoked after any
 * change is applied to any registered CRDT document.
 */
export function subscribeToCrdtChanges(listener: () => void): () => void {
    return automergeRepository.onChange(listener);
}
