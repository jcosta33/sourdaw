import { type Doc } from '@automerge/automerge';

import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

export type ReplaceCrdtDocInLineageInput = {
    id: DocId;
    doc: Doc<unknown>;
};

/**
 * Replace the CRDT document stored under `id` with a new Automerge doc that shares the stored
 * doc's lineage — a sync merge or a rollback to earlier heads of the same document.
 *
 * Used during sync reconciliation: the local doc has been merged with an incoming remote doc
 * (or rolled back to prior heads), and the result needs to become the new canonical snapshot
 * without the document identity moving, since nothing about project membership or lineage
 * changed.
 */
export function replaceCrdtDocInLineage(input: ReplaceCrdtDocInLineageInput): void {
    automergeRepository.replaceDocInLineage(input.id, input.doc);
}
