import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

/**
 * Unregister and release the CRDT document stored under `id`.
 */
export function removeCrdtDoc(id: DocId): void {
    automergeRepository.removeDoc(id);
}
