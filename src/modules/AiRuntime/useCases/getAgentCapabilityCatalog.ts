import {
    APPLICATION_OWNED_CAPABILITY_OPERATIONS,
    isCapabilityReachable,
    type AgentCapabilityOperation,
} from '../models/AgentCapabilityOperations';

import { DEFERRED_AGENT_CAPABILITIES } from './deferredAgentCapabilities';

/** The catalog's own schema identity, carried so a consumer can route on it. */
const AGENT_CAPABILITY_CATALOG_VERSION = 'agent-capability-catalog-v1';

/**
 * The shape of one owner-published protocol contract this catalog reads.
 *
 * Stated structurally rather than imported, because the composition root is what
 * assembles the manifest of contracts and this module publishes into it.
 */
type ProtocolContract = {
    readonly id: string;
    readonly owner: string;
    readonly operations: ReadonlyArray<{
        readonly name: string;
        readonly version: string;
        readonly availability: string;
    }>;
};

type AgentCapabilityCatalogEntry = {
    id: string;
    name: string;
    availability: 'available' | 'unavailable';
    reason: string | null;
    version: string | null;
    evidence: Readonly<Record<string, unknown>>;
};

export type AgentCapabilityCatalog = {
    version: string;
    entries: readonly AgentCapabilityCatalogEntry[];
};

function toApplicationEntry(operation: AgentCapabilityOperation): AgentCapabilityCatalogEntry {
    const reachable = isCapabilityReachable(operation.availability);
    return {
        id: operation.name,
        name: operation.name,
        availability: reachable ? 'available' : 'unavailable',
        reason: operation.reason ?? null,
        // An application tool is versioned by the loop that hosts it, not
        // independently, so the catalog states no version rather than inventing one.
        version: null,
        evidence: {
            surface: 'application-tool',
            owner: operation.owner,
            callable: operation.callable,
            declaredAvailability: operation.availability,
            kind: operation.kind ?? null,
        },
    };
}

/**
 * Declared states in which an owner publishes an operation it cannot be called
 * through. Every other state is a reachable operation whose declared condition
 * the entry reports as its reason rather than as a negative verdict.
 */
const UNREACHABLE_CONTRACT_AVAILABILITIES: readonly string[] = ['deferred', 'unavailable'];

function toContractEntries(contract: ProtocolContract): AgentCapabilityCatalogEntry[] {
    return contract.operations.map((operation) => ({
        id: `${contract.id}:${operation.name}`,
        name: operation.name,
        availability: UNREACHABLE_CONTRACT_AVAILABILITIES.includes(operation.availability)
            ? 'unavailable'
            : 'available',
        reason: operation.availability === 'available' ? null : operation.availability,
        version: operation.version,
        evidence: {
            surface: 'protocol-contract',
            owner: contract.id,
            contractOwner: contract.owner,
            declaredAvailability: operation.availability,
        },
    }));
}

/**
 * Every capability the application publishes: the application-owned tool
 * contracts, the capabilities it deliberately defers, and each operation of the
 * owner protocol contracts the caller supplies.
 *
 * A deferred capability is reported as unreachable with the owner's stated
 * reason rather than omitted, so a consumer reads its absence as a contract
 * instead of inferring it from a silent catalog. Nothing here is synthesized:
 * an entry exists because an owner published the operation behind it.
 */
export function getAgentCapabilityCatalog(protocolContracts: readonly ProtocolContract[]): AgentCapabilityCatalog {
    const applicationOperations: readonly AgentCapabilityOperation[] = [
        ...APPLICATION_OWNED_CAPABILITY_OPERATIONS,
        ...DEFERRED_AGENT_CAPABILITIES,
    ];
    return {
        version: AGENT_CAPABILITY_CATALOG_VERSION,
        entries: [...applicationOperations.map(toApplicationEntry), ...protocolContracts.flatMap(toContractEntries)],
    };
}
