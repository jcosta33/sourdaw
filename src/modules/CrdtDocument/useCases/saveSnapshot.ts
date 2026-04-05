import { type DocumentBundle } from '../models/CrdtDocumentTypes';
import { automergeRepository } from '../repositories/automergeRepository';

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
