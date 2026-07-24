import { type ChangeFn } from '@automerge/automerge';

import { automergeRepository } from '../repositories/automergeRepository';

import { type DocId } from './crdtDocumentTypes';

export type MutateCrdtDocInput<DocShape> = {
    id: DocId;
    changeFn: ChangeFn<DocShape>;
    /**
     * Optional Automerge change message. Used by the snapshot/undo layer and
     * the storage adapter to annotate changes with semantic context.
     */
    message?: string;
    /** Opaque snapshot owner supplied by the repository transaction boundary. */
    snapshotTransaction?: object;
    /**
     * Document keys written by a local CRDT-backed store. Supplied only by the
     * Automerge storage adapter, which already holds the projected truth for
     * those slots — the projection bridge uses them to re-project just what
     * changed instead of every root store (audit CC-1).
     */
    localSlots?: readonly string[];
};

/**
 * Apply an Automerge `changeFn` mutation to the CRDT document at `id`.
 *
 * This is the single write boundary through which Collaboration's sync
 * code applies incremental changes to local documents.
 */
export function mutateCrdtDoc<DocShape = Record<string, unknown>>(input: MutateCrdtDocInput<DocShape>): void {
    automergeRepository.changeDoc<DocShape>(
        input.id,
        input.changeFn,
        input.message,
        input.snapshotTransaction,
        input.localSlots
    );
}
