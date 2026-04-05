import { type DocId } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

/**
 * Unregister and release the CRDT document stored under `id`.
 */
export function removeCrdtDoc(id: DocId): void {
    automergeRepository.removeDoc(id);
}
