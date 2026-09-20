import {
    AGENT_DISCOVERY_DOMAINS,
    AGENT_DISCOVERY_SCHEMA,
    AGENT_DISCOVERY_SCHEMA_VERSION,
    type AgentDiscoveryDomain,
    type AgentDiscoveryFilters,
    type AgentDiscoveryInput,
    type AgentDiscoveryResult,
    type AgentDiscoveryUnavailableReason,
} from '../models/AgentDiscoveryQuery';
import {
    createDiscoverySignature,
    matchesDiscoveryFilters,
    orderDiscoveryCandidates,
    type DiscoveryCandidate,
} from '../services/agentDiscovery/discoveryCandidates';
import { mintDiscoveryCursor, readDiscoveryPage } from '../services/agentDiscovery/discoveryPaging';
import { createBoundedRevisionToken } from '../services/createBoundedRevisionToken';

import { agentCapabilityDiscoveryPort } from './agentCapabilityDiscoveryPort';
import { collectAssetDiscoveryEntries } from './agentDiscovery/collectAssetDiscoveryEntries';
import { collectDeviceDiscoveryEntries } from './agentDiscovery/collectDeviceDiscoveryEntries';
import { collectPresetDiscoveryEntries } from './agentDiscovery/collectPresetDiscoveryEntries';
import { collectSampleDiscoveryEntries } from './agentDiscovery/collectSampleDiscoveryEntries';
import { semanticProjectIndex } from './semanticProjectIndex';

/** Domains whose producers publish a kind vocabulary a caller may filter on. */
const KIND_FILTERED_DOMAINS: readonly AgentDiscoveryDomain[] = ['device', 'preset'];

type Collection =
    | {
          status: 'candidates';
          candidates: DiscoveryCandidate[];
          warnings: string[];
          /** The producer's own revision, when it publishes one. */
          revision: string | null;
      }
    | { status: 'unavailable'; reason: AgentDiscoveryUnavailableReason }
    | { status: 'unsupported'; reason: 'sample-browse-requires-text' };

function isDiscoveryDomain(domain: string): domain is AgentDiscoveryDomain {
    return AGENT_DISCOVERY_DOMAINS.some((candidate) => candidate === domain);
}

function collectDevices(): Collection {
    const collected = collectDeviceDiscoveryEntries();
    if (collected.candidates.length === 0 && !collected.pluginScanRan) {
        return { status: 'unavailable', reason: 'plugin-scan-not-run' };
    }
    return { status: 'candidates', candidates: collected.candidates, warnings: collected.warnings, revision: null };
}

function collectSamples(filters: AgentDiscoveryFilters | undefined): Collection {
    if (filters?.text === undefined) {
        return { status: 'unsupported', reason: 'sample-browse-requires-text' };
    }
    const collected = collectSampleDiscoveryEntries(filters.text);
    if (collected.status === 'catalog-not-indexed') {
        return { status: 'unavailable', reason: 'catalog-not-indexed' };
    }
    if (collected.status === 'query-rejected') {
        return { status: 'unsupported', reason: 'sample-browse-requires-text' };
    }
    return { status: 'candidates', candidates: collected.candidates, warnings: collected.warnings, revision: null };
}

function collectCapabilities(): Collection {
    const catalog = agentCapabilityDiscoveryPort.read();
    if (catalog === null) {
        return { status: 'unavailable', reason: 'capability-provider-unregistered' };
    }
    return {
        status: 'candidates',
        candidates: catalog.entries.map((entry): DiscoveryCandidate => ({
            kind: null,
            entry: { ...entry, domain: 'capability' },
        })),
        warnings: [],
        revision: catalog.version,
    };
}

function collectAssets(): Collection {
    const snapshot = semanticProjectIndex.read();
    return {
        status: 'candidates',
        candidates: collectAssetDiscoveryEntries(snapshot),
        warnings: [],
        // Assets are project truth, so their receipt moves with the project's
        // own revision rather than with a digest of the entries alone.
        revision: snapshot.revisionToken,
    };
}

function collect(domain: AgentDiscoveryDomain, filters: AgentDiscoveryFilters | undefined): Collection {
    if (domain === 'device') {
        return collectDevices();
    }
    if (domain === 'preset') {
        return { status: 'candidates', candidates: collectPresetDiscoveryEntries(), warnings: [], revision: null };
    }
    if (domain === 'sample') {
        return collectSamples(filters);
    }
    if (domain === 'asset') {
        return collectAssets();
    }
    return collectCapabilities();
}

/**
 * A filter this layer cannot honour for the named domain.
 *
 * A kind filter needs a producer that publishes a kind vocabulary. An id filter
 * on a sample would be applied to the one ranked page the catalog returned, so
 * it would report a miss over the rest of the library that the catalog never
 * made.
 */
function isUnsupportedFilter(domain: AgentDiscoveryDomain, filters: AgentDiscoveryFilters | undefined): boolean {
    if (filters?.kind !== undefined && !KIND_FILTERED_DOMAINS.includes(domain)) {
        return true;
    }
    return domain === 'sample' && filters?.stableId !== undefined;
}

/**
 * The filters the producer has not already applied.
 *
 * The catalog matched a sample on its name, path or tags, so re-applying the
 * query text to the display name here would discard the path and tag hits the
 * owner published.
 */
function residualFilters(
    domain: AgentDiscoveryDomain,
    filters: AgentDiscoveryFilters | undefined
): AgentDiscoveryFilters | undefined {
    return domain === 'sample' ? undefined : filters;
}

/**
 * The filter set in one fixed key order, so two callers naming the same filters
 * in different orders read the same page through the same cursor.
 */
function canonicalFilterSignature(filters: AgentDiscoveryFilters | undefined): string {
    return JSON.stringify([filters?.kind ?? null, filters?.stableId ?? null, filters?.text ?? null]);
}

function createRevisionToken(
    domain: AgentDiscoveryDomain,
    candidates: readonly DiscoveryCandidate[],
    revision: string | null
): string {
    if (domain === 'asset' && revision !== null) {
        return revision;
    }
    return createBoundedRevisionToken(`discovery:${domain}:${revision ?? ''}`, createDiscoverySignature(candidates));
}

/**
 * Answer a discovery request as a bounded, revision-bearing receipt over the
 * catalogs their owners publish.
 *
 * Every entry is an owner's record: its stable id, version, availability and
 * evidence are copied, and a producer's own `unavailable` verdict survives into
 * the receipt instead of the entry being dropped. A catalog with nothing to read
 * from answers `unavailable`; a query this layer does not answer is
 * `unsupported`. Neither becomes an empty receipt, which would claim the catalog
 * was read and found empty.
 */
export function queryAgentDiscovery(input: AgentDiscoveryInput): AgentDiscoveryResult {
    if (!isDiscoveryDomain(input.domain)) {
        return { status: 'unsupported', domain: input.domain, reason: 'unknown-domain' };
    }
    const domain = input.domain;
    if (isUnsupportedFilter(domain, input.filters)) {
        return { status: 'unsupported', domain, reason: 'filter-not-supported' };
    }

    const collected = collect(domain, input.filters);
    if (collected.status === 'unavailable') {
        return { status: 'unavailable', domain, reason: collected.reason };
    }
    if (collected.status === 'unsupported') {
        return { status: 'unsupported', domain, reason: collected.reason };
    }

    const revisionToken = createRevisionToken(domain, collected.candidates, collected.revision);
    const matched = collected.candidates.filter((candidate) =>
        matchesDiscoveryFilters(candidate, residualFilters(domain, input.filters))
    );
    // Page in a canonical, content-derived order so a content-free reorder of
    // the producer cannot shift which record a cursor names. The sample catalog
    // already answers in its own ranked, content-derived order, and an asset
    // receipt pages in the project's own order whose revision is order-sensitive;
    // both keep their producer order.
    const ordered = domain === 'sample' || domain === 'asset' ? matched : orderDiscoveryCandidates(matched);
    const fingerprint = createBoundedRevisionToken(
        revisionToken,
        `${domain}:${canonicalFilterSignature(input.filters)}`
    );
    const page = readDiscoveryPage({ limit: input.page?.limit, cursor: input.page?.cursor, fingerprint });
    const nextOffset = page.offset + page.limit;

    return {
        status: 'receipt',
        receipt: {
            schema: AGENT_DISCOVERY_SCHEMA,
            schemaVersion: AGENT_DISCOVERY_SCHEMA_VERSION,
            domain,
            revisionToken,
            page: { offset: page.offset, limit: page.limit, total: ordered.length },
            items: ordered.slice(page.offset, nextOffset).map((candidate) => candidate.entry),
            nextCursor: nextOffset < ordered.length ? mintDiscoveryCursor(fingerprint, nextOffset) : null,
            warnings: collected.warnings,
        },
    };
}
