import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import {
    type CatalogEntryDescription,
    describeCatalogEntry,
    describeIndexedEntryFile,
    findIndexedEntry,
    type IndexedEntry,
} from '../services/agentCatalog/indexedCatalogEntries';
import { libraryStore } from '../stores/libraryStore';

import { resolveDroppedSampleFile } from './resolveDroppedSampleFile';

/**
 * Hand one indexed catalog candidate to a caller as a file plus the terms it
 * comes under.
 *
 * The admission rule is the search's own: a record absent from disk, or one
 * whose root is no longer connected, is unknown here too, so a candidate an
 * agent could not find is a candidate it cannot open either. Nothing decoded
 * lives in this module — the caller owns whatever it makes of the bytes.
 */

type ResolveAgentCatalogCandidateInput = {
    readonly candidateId: string;
};

type ResolveAgentCatalogCandidateResult =
    | {
          readonly status: 'resolved';
          readonly candidate: CatalogEntryDescription;
          readonly file: File;
      }
    | { readonly status: 'rejected'; readonly reason: 'unknown-catalog-id' | 'file-unavailable' };

async function readEntryFile(entry: IndexedEntry): Promise<File | null> {
    try {
        const resolved = await resolveDroppedSampleFile(describeIndexedEntryFile(entry));
        return resolved.status === 'resolved' ? resolved.file : null;
    } catch {
        return null;
    }
}

export async function resolveAgentCatalogCandidate({
    candidateId,
}: ResolveAgentCatalogCandidateInput): Promise<ResolveAgentCatalogCandidateResult> {
    const entry = findIndexedEntry(libraryStore.value, candidateId);
    if (!entry) {
        return { status: 'rejected', reason: 'unknown-catalog-id' };
    }

    const file = await readEntryFile(entry);
    if (!file) {
        return { status: 'rejected', reason: 'file-unavailable' };
    }

    return {
        status: 'resolved',
        candidate: describeCatalogEntry(entry, FACTORY_LIBRARY_ROOT_ID),
        file,
    };
}
