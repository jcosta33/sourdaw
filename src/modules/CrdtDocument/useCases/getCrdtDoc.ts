import { type Doc } from '@automerge/automerge';

import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

/**
 * Read a CRDT document by ID.
 *
 * Returns `undefined` when no document is registered under that ID. The
 * returned `Doc<DocShape>` is an Automerge snapshot — consumers must use
 * Automerge APIs to read fields but must never mutate it directly.
 */
export function getCrdtDoc<DocShape = Record<string, unknown>>(id: DocId): Doc<DocShape> | undefined {
    return automergeRepository.getDoc<DocShape>(id);
}
