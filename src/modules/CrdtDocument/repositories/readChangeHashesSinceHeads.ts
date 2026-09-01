import { type Heads, decodeChange, getMissingDeps } from '@automerge/automerge';

import { type DocId } from '../models/CrdtDocumentTypes';

import { automergeRepository } from './automergeRepository';

/**
 * Hashes of the changes `docId` received after `heads`, in causal order.
 * Null when `heads` are not part of this document's history, so no path leads
 * from them to its current state.
 */
export function readChangeHashesSinceHeads(docId: DocId, heads: Heads): string[] | null {
    const document = automergeRepository.getDoc(docId);
    if (!document || getMissingDeps(document, heads).length > 0) {
        return null;
    }
    return automergeRepository.getChanges(docId, heads).map((changeBytes) => decodeChange(changeBytes).hash);
}
