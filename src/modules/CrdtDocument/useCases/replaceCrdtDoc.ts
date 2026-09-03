import { type Doc } from '@automerge/automerge';

import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

export type ReplaceCrdtDocInput = {
    id: DocId;
    doc: Doc<unknown>;
};

/**
 * Replace the CRDT document stored under `id` with a new Automerge doc, moving the document
 * identity epoch. Kept as the seam specs use to model an identity-moving project replacement;
 * production routes that move identity — branch fork, switch, merge, transition, snapshot
 * restore, project load — call `automergeRepository.replaceDoc` directly instead. A sync uses
 * `replaceCrdtDocInLineage`, which leaves the identity epoch unchanged.
 */
export function replaceCrdtDoc(input: ReplaceCrdtDocInput): void {
    automergeRepository.replaceDoc(input.id, input.doc);
}
