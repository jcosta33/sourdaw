import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

/**
 * A CRDT-backed store write reaches the Automerge project document on a
 * deferred animation frame, so a flow that reads the project document right
 * after the write races that frame instead of observing a state every run
 * shares. An edit is not an edit to the project until the document holds it,
 * so run the write and commit its pending storage write before any AI
 * workflow flow reads the document.
 */
export function landProjectEdit(write: () => void): void {
    write();
    flushAutomergeStorageWrites();
}
