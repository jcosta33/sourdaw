import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

/**
 * Check whether a CRDT document is registered under the given ID.
 */
export function hasCrdtDoc(id: DocId): boolean {
    return automergeRepository.hasDoc(id);
}
