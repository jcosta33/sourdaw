import { type Doc } from '@automerge/automerge';

import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

export type ReplaceCrdtDocInput = {
    id: DocId;
    doc: Doc<unknown>;
};

/**
 * Replace the CRDT document stored under `id` with a new Automerge doc, moving the document
 * identity epoch — a membership or lineage change: branch fork/switch/transition, snapshot
 * restore, or project load. A sync merge or rollback that stays on the stored doc's own lineage
 * uses `replaceCrdtDocInLineage` instead, which leaves the identity epoch unchanged.
 */
export function replaceCrdtDoc(input: ReplaceCrdtDocInput): void {
    automergeRepository.replaceDoc(input.id, input.doc);
}
