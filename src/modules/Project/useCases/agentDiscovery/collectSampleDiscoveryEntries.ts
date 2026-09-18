import { libraryStore } from '#/modules/SampleLibrary/stores';
import { searchAgentCatalog } from '#/modules/SampleLibrary/useCases';

import { AGENT_DISCOVERY_SAMPLE_QUERY_LIMIT } from '../../models/AgentDiscoveryQuery';
import { type DiscoveryCandidate } from '../../services/agentDiscovery/discoveryCandidates';

type CatalogCandidate = Extract<ReturnType<typeof searchAgentCatalog>, { status: 'results' }>['items'][number];

export type SampleDiscoveryCollection =
    | { status: 'entries'; candidates: DiscoveryCandidate[]; warnings: string[] }
    | { status: 'catalog-not-indexed' }
    | { status: 'query-rejected' };

/**
 * One catalog candidate as a discovery entry.
 *
 * The catalog answers only over records it holds and resolves every candidate
 * it returns, so a candidate is an available sample whatever index state its
 * record carries; that state travels in the evidence rather than becoming a
 * verdict this layer invented.
 */
function toSampleCandidate(candidate: CatalogCandidate): DiscoveryCandidate {
    return {
        kind: null,
        entry: {
            id: candidate.id,
            name: candidate.displayName,
            domain: 'sample',
            availability: 'available',
            reason: null,
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
 * The search runs at the catalog's published ceiling so the page this layer
 * reports counts every match the owner returned, and the catalog's truncation
 * flag survives as a warning. A library with no operable root is a catalog that
 * has not been indexed, which is a different answer from a root that is indexed
 * and matched nothing.
 */
export function collectSampleDiscoveryEntries(text: string): SampleDiscoveryCollection {
    const roots = libraryStore.value?.roots ?? [];
    if (!roots.some((root) => root.status === 'ready')) {
        return { status: 'catalog-not-indexed' };
    }
    const result = searchAgentCatalog({ text, limit: AGENT_DISCOVERY_SAMPLE_QUERY_LIMIT });
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
