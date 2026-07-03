import { clone, getAllChanges, load, merge } from '@automerge/automerge';

import { type DocumentBundle, DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
import { automergeRepository } from '../../repositories/automergeRepository';

type ImportDecision = 'merge' | 'separate';

/**
 * Determine how to import a bundle based on shared lineage.
 *
 * - `merge`: shares history with the local project - merge directly
 * - `separate`: unrelated project - open separately
 */
export function detectImportDecision(bundle: DocumentBundle): ImportDecision {
    const incomingRootBytes = bundle.get(DOC_PREFIX_ROOT);
    if (!incomingRootBytes) {
        return 'separate';
    }

    const localDoc = automergeRepository.getDoc(DOC_PREFIX_ROOT);
    if (!localDoc) {
        return 'separate';
    }

    // Check if the incoming doc shares lineage by attempting a trial merge.
    // If the merge produces more changes than either doc alone, they share history.
    try {
        const incomingDoc = load(incomingRootBytes);

        // Trial merge on a clone - doesn't modify the real doc.
        const trialDoc = clone(localDoc);
        const merged = merge(trialDoc, incomingDoc);

        const localChangeCount = getAllChanges(localDoc).length;
        const incomingChangeCount = getAllChanges(incomingDoc).length;
        const mergedChangeCount = getAllChanges(merged).length;

        // If merged has fewer changes than the sum, they share some history.
        if (mergedChangeCount < localChangeCount + incomingChangeCount) {
            return 'merge';
        }

        // No shared history - completely independent documents.
        return 'separate';
    } catch {
        return 'separate';
    }
}
