import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

/**
 * List the IDs of all CRDT documents currently registered.
 */
export function getCrdtDocIds(): DocId[] {
    return automergeRepository.getDocIds();
}
