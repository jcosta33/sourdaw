import { type ChangeFn } from '@automerge/automerge';
import { type DocId } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

export type MutateCrdtDocInput<DocShape> = {
    id: DocId;
    changeFn: ChangeFn<DocShape>;
};

/**
 * Apply an Automerge `changeFn` mutation to the CRDT document at `id`.
 *
 * This is the single write boundary through which Collaboration's sync
 * code applies incremental changes to local documents.
 */
export function mutateCrdtDoc<DocShape = Record<string, unknown>>(input: MutateCrdtDocInput<DocShape>): void {
    automergeRepository.changeDoc<DocShape>(input.id, input.changeFn);
}
