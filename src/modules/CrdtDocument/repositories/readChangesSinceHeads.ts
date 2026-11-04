import { type Heads, decodeChange, getMissingDeps } from '@automerge/automerge';

import { type DocId } from '../models/CrdtDocumentTypes';

import { automergeRepository } from './automergeRepository';

/**
 * Changes `docId` received after `heads`, with their causal dependencies.
 * Null when `heads` are not part of this document's history, so no path leads
 * from them to its current state.
 */
export function readChangesSinceHeads(docId: DocId, heads: Heads): { hash: string; deps: Heads }[] | null {
    const document = automergeRepository.getDoc(docId);
    if (!document || getMissingDeps(document, heads).length > 0) {
        return null;
    }
    return automergeRepository.getChanges(docId, heads).map((changeBytes) => {
        const { hash, deps } = decodeChange(changeBytes);
        return { hash, deps };
    });
}
