import { type DocId } from './crdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

/**
 * List the IDs of all CRDT documents currently registered.
 */
export function getCrdtDocIds(): DocId[] {
    return automergeRepository.getDocIds();
}
