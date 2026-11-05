import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import {
    type CatalogEntryDescription,
    describeCatalogEntry,
    describeIndexedEntryFile,
    findIndexedEntry,
    type IndexedEntry,
} from '../services/agentCatalog/indexedCatalogEntries';
import { libraryStore } from '../stores/libraryStore';

import { ensureFactorySampleBuffer } from './ensureFactorySampleBuffer';
import { resolveDroppedSampleFile } from './resolveDroppedSampleFile';

/**
 * Hand one indexed catalog candidate to a caller as its audio source plus the
 * terms it comes under: a file to decode, or, for a factory sample, the
 * resident buffer under the sample's own id.
 *
 * The admission rule is the search's own: a record absent from disk, or one
 * whose root is no longer connected, is unknown here too, so a candidate an
 * agent could not find is a candidate it cannot open either. Nothing decoded
 * lives in this module — the caller owns whatever it makes of the bytes. A
 * factory sample has no file, so its source is the buffer
 * `ensureFactorySampleBuffer` obtains, never a second copy.
 */

type AgentCatalogAudioSource =
    | { readonly kind: 'file'; readonly file: File }
    | { readonly kind: 'buffer'; readonly audioBufferId: string; readonly buffer: AudioBuffer };

type ResolveAgentCatalogCandidateInput = {
    readonly candidateId: string;
};

type ResolveAgentCatalogCandidateResult =
    | {
          readonly status: 'resolved';
          readonly candidate: CatalogEntryDescription;
          readonly source: AgentCatalogAudioSource;
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

async function readFactoryBuffer(entry: IndexedEntry): Promise<AgentCatalogAudioSource | null> {
    try {
        const factoryBuffer = await ensureFactorySampleBuffer({ sampleId: entry.record.id });
        if (factoryBuffer.status !== 'resolved') {
            return null;
        }
        return { kind: 'buffer', audioBufferId: entry.record.id, buffer: factoryBuffer.buffer };
    } catch {
        return null;
    }
}

async function readEntrySource(entry: IndexedEntry): Promise<AgentCatalogAudioSource | null> {
    if (entry.record.libraryRootId === FACTORY_LIBRARY_ROOT_ID) {
        return readFactoryBuffer(entry);
    }
    const file = await readEntryFile(entry);
    return file ? { kind: 'file', file } : null;
}

export async function resolveAgentCatalogCandidate({
    candidateId,
}: ResolveAgentCatalogCandidateInput): Promise<ResolveAgentCatalogCandidateResult> {
    const entry = findIndexedEntry(libraryStore.value, candidateId);
    if (!entry) {
        return { status: 'rejected', reason: 'unknown-catalog-id' };
    }

    const source = await readEntrySource(entry);
    if (!source) {
        return { status: 'rejected', reason: 'file-unavailable' };
    }

    return {
        status: 'resolved',
        candidate: describeCatalogEntry(entry, FACTORY_LIBRARY_ROOT_ID),
        source,
    };
}
