import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

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
 * nothing.
 */
export function landProjectEdit(write: () => void): void {
    const result: unknown = write();
    if (typeof (result as { then?: unknown })?.then === 'function') {
        throw new TypeError(
            'landProjectEdit takes a synchronous store write; an action must be awaited instead of passed here.'
        );
    }
    flushAutomergeStorageWrites();
}
