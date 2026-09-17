import { libraryStore } from '#/modules/SampleLibrary/stores';
import { searchAgentCatalog } from '#/modules/SampleLibrary/useCases';

import { type DiscoveryCandidate } from '../../services/agentDiscovery/discoveryCandidates';

/** Index states in which the library holds the sample's content, not merely its path. */
const INDEXED_SAMPLE_STATUSES: readonly string[] = ['indexed', 'analyzed'];

type CatalogCandidate = Extract<ReturnType<typeof searchAgentCatalog>, { status: 'results' }>['items'][number];

export type SampleDiscoveryCollection =
    | { status: 'entries'; candidates: DiscoveryCandidate[]; warnings: string[] }
    | { status: 'catalog-not-indexed' }
    | { status: 'query-rejected' };

function toSampleCandidate(candidate: CatalogCandidate): DiscoveryCandidate {
    const indexStatus = candidate.provenance.indexStatus;
    const indexed = INDEXED_SAMPLE_STATUSES.includes(indexStatus);
    return {
        kind: null,
        entry: {
            id: candidate.id,
            name: candidate.displayName,
            domain: 'sample',
            availability: indexed ? 'available' : 'unavailable',
            reason: indexed ? null : indexStatus,
            // The catalog versions no candidate; it answers from the record it
            // holds now and reports the evidence that matched.
            version: null,
            evidence: {
                source: 'agent-catalog-search',
                provenance: candidate.provenance,
                licensing: candidate.licensing,
                score: candidate.score,
            },
        },
    };
}

/**
 * The sample library's own answer to one text query, projected entry by entry.
 *
 * The search bound belongs to the library: this layer names no limit, so the
 * catalog answers at its own published ceiling and reports whether more matched
 * than it returned. A library holding no records at all is a catalog that has
 * not been indexed, which is a different answer from one that matched nothing.
 */
export function collectSampleDiscoveryEntries(text: string): SampleDiscoveryCollection {
    if ((libraryStore.value?.samples ?? []).length === 0) {
        return { status: 'catalog-not-indexed' };
    }
    const result = searchAgentCatalog({ text });
    if (result.status === 'rejected') {
        return { status: 'query-rejected' };
    }
    const catalogWarnings = result.warnings.map((warning) => `sample-catalog:${warning}`);
    return {
        status: 'entries',
        candidates: result.items.map(toSampleCandidate),
        warnings: result.truncated ? ['sample-catalog-truncated', ...catalogWarnings] : catalogWarnings,
    };
}
