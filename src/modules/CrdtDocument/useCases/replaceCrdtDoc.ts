import { type Doc } from '@automerge/automerge';
import { type DocId } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

export type ReplaceCrdtDocInput = {
    id: DocId;
    doc: Doc<unknown>;
};

/**
 * Replace the CRDT document stored under `id` with a new Automerge doc.
 *
 * Used during sync reconciliation when the local doc has been merged with
 * an incoming remote doc and the merged result needs to become the new
 * canonical snapshot.
 */
export function replaceCrdtDoc(input: ReplaceCrdtDocInput): void {
    automergeRepository.replaceDoc(input.id, input.doc);
}
