import { FACTORY_LIBRARY_ROOT_ID } from '#/modules/FactorySynthesis/useCases';

import {
    AGENT_CATALOG_DEFAULT_LIMIT,
    AGENT_CATALOG_MAX_LIMIT,
    AGENT_CATALOG_SEARCH_SCHEMA,
    AGENT_CATALOG_SEARCH_SCHEMA_VERSION,
    type AgentCatalogCandidate,
    type AgentCatalogDescriptors,
    type AgentCatalogEvidence,
    type AgentCatalogLicensing,
    type AgentCatalogProvenance,
    type AgentCatalogSearchInput,
    type AgentCatalogSearchResult,
} from '../models/AgentCatalogTypes';
import { type LibraryRoot, type SampleRecord, type SpectralDescriptors } from '../models/LibraryTypes';
import { type LibraryState, libraryStore } from '../stores/libraryStore';

import { findSimilarSamples } from './findSimilarSamples';

/** Evidence weights: a name hit is the strongest textual signal, a path hit the weakest. */
const TEXT_EVIDENCE_WEIGHTS = { name: 3, tag: 2, path: 1 } as const;

const displayNameCollator = new Intl.Collator();

/** A record paired with the root that supplies its provenance. */
type IndexedEntry = { record: SampleRecord; root: LibraryRoot };

type EvidenceMatch = { entry: IndexedEntry; evidence: readonly AgentCatalogEvidence[] };

type ResolvedQuery =
    | { kind: 'text'; text: string }
    | { kind: 'similar'; similarTo: string }
    | { kind: 'text-and-similar'; text: string; similarTo: string };

type MatchOutcome = { status: 'similarity-unavailable' } | { status: 'matched'; matches: readonly EvidenceMatch[] };

function resolveLimit(limit: number | undefined): number | null {
    if (limit === undefined) {
        return AGENT_CATALOG_DEFAULT_LIMIT;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > AGENT_CATALOG_MAX_LIMIT) {
        return null;
    }
    return limit;
}

function normalizeQueryText(text: string | undefined): string | null {
    if (text === undefined) {
        return null;
    }
    const trimmed = text.trim();
    if (trimmed.length === 0) {
        return null;
    }
    return trimmed;
}

function resolveQuery(input: AgentCatalogSearchInput): ResolvedQuery | null {
    const text = normalizeQueryText(input.text);
    const similarTo = input.similarTo ?? null;
    if (text !== null && similarTo !== null) {
        return { kind: 'text-and-similar', text, similarTo };
    }
    if (text !== null) {
        return { kind: 'text', text };
    }
    if (similarTo !== null) {
        return { kind: 'similar', similarTo };
    }
    return null;
}

function getQueryAnchorId(query: ResolvedQuery): string | null {
    if (query.kind === 'text') {
        return null;
    }
    return query.similarTo;
}

function getQueryText(query: ResolvedQuery): string | null {
    if (query.kind === 'similar') {
        return null;
    }
    return query.text;
}

/**
 * Records the catalog may answer with: present on disk, and belonging to a root
 * still in the store. A record whose root is gone has no provenance to derive,
 * and provenance is never guessed.
 */
function collectIndexedEntries(state: LibraryState | null): readonly IndexedEntry[] {
    if (state === null) {
        return [];
    }
    const rootsById = new Map(state.roots.map((root) => [root.id, root]));
    const entries: IndexedEntry[] = [];
    for (const record of state.samples) {
        if (!record.sync.exists) {
            continue;
        }
        const root = rootsById.get(record.libraryRootId);
        if (root === undefined) {
            continue;
        }
        entries.push({ record, root });
    }
    return entries;
}

/** The LibraryBrowser text law: lowercase `includes` on name, path, and each tag. */
function collectTextEvidence(record: SampleRecord, term: string): AgentCatalogEvidence[] {
    const needle = term.toLowerCase();
    const evidence: AgentCatalogEvidence[] = [];
    if (record.displayName.toLowerCase().includes(needle)) {
        evidence.push({ kind: 'name', term, matched: record.displayName });
    }
    if (record.relativePath.toLowerCase().includes(needle)) {
        evidence.push({ kind: 'path', term, matched: record.relativePath });
    }
    for (const tag of record.tags) {
        if (tag.toLowerCase().includes(needle)) {
            evidence.push({ kind: 'tag', term, matched: tag });
        }
    }
    return evidence;
}

function matchByText(entries: readonly IndexedEntry[], text: string): EvidenceMatch[] {
    const matches: EvidenceMatch[] = [];
    for (const entry of entries) {
        const evidence = collectTextEvidence(entry.record, text);
        if (evidence.length === 0) {
            continue;
        }
        matches.push({ entry, evidence });
    }
    return matches;
}

function matchBySimilarity(args: {
    entries: readonly IndexedEntry[];
    anchorId: string;
    rankedIds: readonly string[];
}): EvidenceMatch[] {
    const { entries, anchorId, rankedIds } = args;
    const entriesById = new Map(entries.map((entry) => [entry.record.id, entry]));
    const matches: EvidenceMatch[] = [];
    // Rank is the position in the similarity ranking, so an id the catalog
    // cannot answer with does not promote the ones behind it.
    let rank = 0;
    for (const id of rankedIds) {
        rank += 1;
        if (id === anchorId) {
            continue;
        }
        const entry = entriesById.get(id);
        if (entry === undefined) {
            continue;
        }
        matches.push({ entry, evidence: [{ kind: 'similar-to', anchorId, rank }] });
    }
    return matches;
}

function keepTextMatches(matches: readonly EvidenceMatch[], text: string): EvidenceMatch[] {
    const kept: EvidenceMatch[] = [];
    for (const match of matches) {
        const textEvidence = collectTextEvidence(match.entry.record, text);
        if (textEvidence.length === 0) {
            continue;
        }
        kept.push({ entry: match.entry, evidence: [...textEvidence, ...match.evidence] });
    }
    return kept;
}

function matchEntries(entries: readonly IndexedEntry[], query: ResolvedQuery): MatchOutcome {
    if (query.kind === 'text') {
        return { status: 'matched', matches: matchByText(entries, query.text) };
    }
    const similar = findSimilarSamples(query.similarTo, AGENT_CATALOG_MAX_LIMIT);
    if (similar.status === 'unavailable') {
        return { status: 'similarity-unavailable' };
    }
    const matches = matchBySimilarity({ entries, anchorId: query.similarTo, rankedIds: similar.sampleIds });
    if (query.kind === 'similar') {
        return { status: 'matched', matches };
    }
    return { status: 'matched', matches: keepTextMatches(matches, query.text) };
}

function scoreEvidence(evidence: readonly AgentCatalogEvidence[]): number {
    let score = 0;
    for (const entry of evidence) {
        if (entry.kind === 'similar-to') {
            score += AGENT_CATALOG_MAX_LIMIT + 1 - entry.rank;
            continue;
        }
        score += TEXT_EVIDENCE_WEIGHTS[entry.kind];
    }
    return score;
}

function toLicensing(origin: AgentCatalogProvenance['origin']): AgentCatalogLicensing {
    if (origin === 'factory') {
        return { source: 'factory', rightsHolder: 'sourdaw', terms: 'bundled-with-sourdaw' };
    }
    return { source: 'user-library', rightsHolder: 'user', terms: 'as-licensed-to-the-user' };
}

function toSpectralDescriptors(descriptors: SpectralDescriptors | undefined): SpectralDescriptors | null {
    if (descriptors === undefined) {
        return null;
    }
    return structuredClone(descriptors);
}

function toDescriptors(record: SampleRecord): AgentCatalogDescriptors {
    return {
        textual: {
            displayName: record.displayName,
            folder: record.folder,
            ext: record.ext,
            tags: [...record.tags],
        },
        measurable: {
            durationSec: record.format.durationSec ?? null,
            sampleRate: record.format.sampleRate ?? null,
            channels: record.format.channels ?? null,
            bpm: record.analysis?.bpm ?? null,
            key: record.analysis?.key ?? null,
            spectral: toSpectralDescriptors(record.analysis?.descriptors),
        },
    };
}

function toCandidate(match: EvidenceMatch): AgentCatalogCandidate {
    const { record, root } = match.entry;
    const origin = record.libraryRootId === FACTORY_LIBRARY_ROOT_ID ? 'factory' : 'connected-library';
    return {
        id: record.id,
        kind: 'sample',
        displayName: record.displayName,
        provenance: {
            origin,
            libraryRootId: record.libraryRootId,
            libraryRootName: root.name,
            provider: root.provider,
            relativePath: record.relativePath,
            indexStatus: record.sync.status,
        },
        licensing: toLicensing(origin),
        descriptors: toDescriptors(record),
        evidence: [...match.evidence],
        score: scoreEvidence(match.evidence),
    };
}

function compareCandidates(left: AgentCatalogCandidate, right: AgentCatalogCandidate): number {
    if (left.score !== right.score) {
        return right.score - left.score;
    }
    const byDisplayName = displayNameCollator.compare(left.displayName, right.displayName);
    if (byDisplayName !== 0) {
        return byDisplayName;
    }
    if (left.id < right.id) {
        return -1;
    }
    if (left.id > right.id) {
        return 1;
    }
    return 0;
}

function toResults(args: {
    query: ResolvedQuery;
    limit: number;
    candidates: readonly AgentCatalogCandidate[];
    warnings: readonly string[];
}): AgentCatalogSearchResult {
    const { query, limit, candidates, warnings } = args;
    return {
        status: 'results',
        schema: AGENT_CATALOG_SEARCH_SCHEMA,
        schemaVersion: AGENT_CATALOG_SEARCH_SCHEMA_VERSION,
        query: { text: getQueryText(query), similarTo: getQueryAnchorId(query), limit },
        items: candidates.slice(0, limit),
        total: candidates.length,
        truncated: candidates.length > limit,
        warnings,
    };
}

/**
 * Answer an agent's catalog query from the indexed sample library.
 *
 * The answer is closed over the store: an entry exists here only because a
 * record for it exists there, and each candidate reports the evidence that
 * matched it. Candidates are rebuilt from the record, so a caller holding the
 * result cannot reach back into library state through it.
 */
export function searchAgentCatalog(input: AgentCatalogSearchInput): AgentCatalogSearchResult {
    const limit = resolveLimit(input.limit);
    if (limit === null) {
        return { status: 'rejected', reason: 'limit-out-of-range' };
    }

    const query = resolveQuery(input);
    if (query === null) {
        return { status: 'rejected', reason: 'empty-query' };
    }

    const state = libraryStore.value;
    const entries = collectIndexedEntries(state);
    const anchorId = getQueryAnchorId(query);
    if (anchorId !== null && !entries.some((entry) => entry.record.id === anchorId)) {
        return { status: 'rejected', reason: 'unknown-catalog-id' };
    }

    const outcome = matchEntries(entries, query);
    if (outcome.status === 'similarity-unavailable') {
        return toResults({ query, limit, candidates: [], warnings: ['similarity-unavailable'] });
    }

    const candidates = outcome.matches.map(toCandidate).sort(compareCandidates);
    return toResults({ query, limit, candidates, warnings: [] });
}
