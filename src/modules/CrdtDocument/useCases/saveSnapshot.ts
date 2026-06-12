import { automergeRepository } from '../repositories/automergeRepository';

import { type DocumentBundle } from './crdtDocumentTypes';

/**
 * Serialize all in-memory CRDT documents to a binary snapshot bundle.
 * Intended for undo/redo snapshot capture (e.g. DSO snapshot in AiRuntime).
 *
 * Public use-case surface so callers do not need to reach into the private
 * repositories/ folder.
 */
export function saveSnapshot(): DocumentBundle {
    return automergeRepository.saveAll();
}

/**
 * Execute a mutating function and capture binary snapshots only for the
 * documents that were dirtied during its execution.
 */
export async function transactSnapshot(
    fn: () => Promise<void>
): Promise<{ before: DocumentBundle; after: DocumentBundle }> {
    return automergeRepository.transactSnapshot(fn);
}
