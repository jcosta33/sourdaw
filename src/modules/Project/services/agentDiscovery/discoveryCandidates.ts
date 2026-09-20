import { type AgentDiscoveryEntry, type AgentDiscoveryFilters } from '../../models/AgentDiscoveryQuery';

/**
 * One projected entry together with the producer's own word for its kind.
 *
 * The kind travels beside the entry rather than inside its evidence so that
 * filtering never has to read an untyped evidence field back out. A producer
 * that publishes no kind supplies `null`, and a `kind` filter then matches
 * nothing rather than everything.
 */
export type DiscoveryCandidate = {
    entry: AgentDiscoveryEntry;
    kind: string | null;
    /** Owner-published text associations, kept outside opaque entry evidence for filtering. */
    searchTerms?: readonly string[];
};

function matchesText(candidate: DiscoveryCandidate, text: string): boolean {
    const normalizedText = text.toLocaleLowerCase();
    const searchableText = [candidate.entry.name];
    if (candidate.searchTerms) {
        searchableText.push(...candidate.searchTerms);
    }
    return searchableText.some((value) => value.toLocaleLowerCase().includes(normalizedText));
}

/** Filters a caller may apply to any answered domain, applied to one candidate. */
export function matchesDiscoveryFilters(
    candidate: DiscoveryCandidate,
    filters: AgentDiscoveryFilters | undefined
): boolean {
    if (!filters) {
        return true;
    }
    if (filters.stableId !== undefined && candidate.entry.id !== filters.stableId) {
        return false;
    }
    if (filters.text !== undefined && !matchesText(candidate, filters.text)) {
        return false;
    }
    if (filters.kind !== undefined && candidate.kind !== filters.kind) {
        return false;
    }
    return true;
}

/**
 * The content a domain's revision token is taken over: every entry's stable id,
 * the producer's version for it, and its availability. A catalog that gains,
 * loses or re-versions an entry mints a different token; one that answers the
 * same entries twice mints the same token twice.
 */
export function createDiscoverySignature(candidates: readonly DiscoveryCandidate[]): string {
    const rows = candidates.map(({ entry }) => JSON.stringify([entry.id, entry.version, entry.availability]));
    return JSON.stringify(rows.toSorted());
}
