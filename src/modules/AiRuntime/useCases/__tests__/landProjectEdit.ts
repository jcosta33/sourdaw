import {
    flushAutomergeStorageWrites,
    hasPendingAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';

/**
 * A CRDT-backed store write reaches the Automerge project document on a
 * deferred animation frame, so a flow that reads the project document right
 * after the write races that frame instead of observing a state every run
 * shares. An edit is not an edit to the project until the document holds it,
 * so run the write and commit its pending storage write before any AI
 * workflow flow reads the document. This is for a raw, synchronous store
 * write only: an `executeAppAction` call already lands its write in the
 * document before it resolves, so it must be awaited on its own instead of
 * passed here, where a flush racing its still-pending write would land
 * nothing. The check below observes the pending write itself rather than the
 * callback's return value, because a block-bodied wrap around an action call
 * discards the promise a thenable check would have to see.
 */
export function landProjectEdit(write: () => void): void {
    write();
    if (!hasPendingAutomergeStorageWrites()) {
        throw new TypeError(
            'landProjectEdit landed nothing in the project document: it takes a synchronous CRDT-backed store write, and an action must be awaited on its own instead of passed here.'
        );
    }
    flushAutomergeStorageWrites();
}
