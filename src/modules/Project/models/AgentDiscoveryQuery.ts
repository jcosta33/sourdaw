/**
 * Agent-facing vocabulary for discovery over the catalogs other owners publish.
 *
 * A discovery receipt is a projection, never a catalog of its own: every entry
 * is built from an owner-published record, carries that owner's stable id,
 * version and evidence unchanged, and keeps the owner's own `unavailable`
 * verdict rather than dropping the entry. A query the layer cannot answer is
 * `unsupported`; a catalog that exists but has nothing to read from is
 * `unavailable`. The two are different answers and never collapse into one.
 */

export const AGENT_DISCOVERY_SCHEMA = 'sourdaw.agent-discovery-receipt';

export const AGENT_DISCOVERY_SCHEMA_VERSION = 1 as const;

export const AGENT_DISCOVERY_DOMAINS = ['device', 'preset', 'sample', 'asset', 'capability'] as const;

/**
 * The page size a sample discovery request asks the catalog for: the ceiling
 * that catalog publishes, so one discovery page counts every match it returned
 * rather than the smaller default page it answers an unbounded request with.
 * The ceiling lives in the catalog owner's private model, so a spec asserts the
 * catalog still accepts this figure.
 */
export const AGENT_DISCOVERY_SAMPLE_QUERY_LIMIT = 24;

export type AgentDiscoveryDomain = (typeof AGENT_DISCOVERY_DOMAINS)[number];

export type AgentDiscoveryFilters = {
    text?: string;
    stableId?: string;
    kind?: string;
};

// The domain reaches this layer from an agent tool call, so it is a plain
// string here and is narrowed against AGENT_DISCOVERY_DOMAINS at the entry.
export type AgentDiscoveryInput = {
    domain: string;
    filters?: AgentDiscoveryFilters;
    page?: {
        limit?: number;
        cursor?: string;
    };
};

/**
 * One owner-published record. `id`, `name`, `version` and `evidence` are copied
 * from the producer; `availability` restates the producer's own verdict, and
 * `reason` is the producer's word for it, null when the producer gave none.
 */
export type AgentDiscoveryEntry = {
    id: string;
    name: string;
    domain: AgentDiscoveryDomain;
    availability: 'available' | 'unavailable';
    reason: string | null;
    version: string | null;
    evidence: Readonly<Record<string, unknown>>;
};

export type AgentDiscoveryReceipt = {
    schema: typeof AGENT_DISCOVERY_SCHEMA;
    schemaVersion: typeof AGENT_DISCOVERY_SCHEMA_VERSION;
    domain: AgentDiscoveryDomain;
    revisionToken: string;
    page: {
        offset: number;
        limit: number;
        total: number;
    };
    items: AgentDiscoveryEntry[];
    nextCursor: string | null;
    warnings: string[];
};

/** Why a catalog that exists cannot be read right now. */
export type AgentDiscoveryUnavailableReason =
    'capability-provider-unregistered' | 'catalog-not-indexed' | 'plugin-scan-not-run';

/** Why the query itself is outside what this layer answers. */
export type AgentDiscoveryUnsupportedReason = 'unknown-domain' | 'sample-browse-requires-text' | 'filter-not-supported';

export type AgentDiscoveryResult =
    | { status: 'receipt'; receipt: AgentDiscoveryReceipt }
    | { status: 'unavailable'; domain: AgentDiscoveryDomain; reason: AgentDiscoveryUnavailableReason }
    // An unknown domain is echoed as the caller spelled it, so `domain` is
    // wider here than the answered domains above.
    | { status: 'unsupported'; domain: string; reason: AgentDiscoveryUnsupportedReason };
