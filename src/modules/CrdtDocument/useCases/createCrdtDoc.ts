import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

/**
 * Create an empty child CRDT document under the given ID.
 *
 * Used by Collaboration when sync receives a doc ID that does not yet exist
 * locally and needs to be materialised before its incremental changes are
 * applied.
 */
export function createCrdtDoc(id: DocId): void {
    automergeRepository.createChildDoc(id);
}
