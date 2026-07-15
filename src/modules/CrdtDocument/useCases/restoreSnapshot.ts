import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';

import { type CrdtDocumentSnapshot } from '../models/CrdtDocumentSnapshot';
import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Restore exact in-memory CRDT content and membership from a snapshot.
 * Intended for undo/redo operations (e.g. DSO snapshot restore from Command module).
 *
 * Public use-case surface so callers do not need to reach into the private
 * repositories/ folder.
 */
export function restoreSnapshot(snapshot: CrdtDocumentSnapshot): void {
    // Older frame writes belong before the undo/redo replacement. Draining
    // them first prevents a queued adapter from replaying into a removed doc.
    flushAutomergeStorageWrites();
    automergeRepository.restoreSnapshot(snapshot);
}
