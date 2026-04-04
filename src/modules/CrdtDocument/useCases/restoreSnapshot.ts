import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Restore all in-memory CRDT documents from a binary snapshot bundle.
 * Intended for undo/redo operations (e.g. DSO snapshot restore from Command module).
 *
 * Public use-case surface so callers do not need to reach into the private
 * repositories/ folder.
 */
export function restoreSnapshot(bundle: Map<string, Uint8Array>): void {
    automergeRepository.restoreSnapshot(bundle);
}
