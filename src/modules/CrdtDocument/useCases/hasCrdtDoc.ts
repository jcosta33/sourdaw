import { type DocId } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Check whether a CRDT document is registered under the given ID.
 */
export function hasCrdtDoc(id: DocId): boolean {
    return automergeRepository.hasDoc(id);
}
