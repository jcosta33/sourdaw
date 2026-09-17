import {
    AGENT_COMMAND_LEDGER,
    AGENT_COMMAND_LEDGER_SCHEMA_VERSION,
    AGENT_COMMAND_LEDGER_UNCOVERED_CATEGORIES,
    AGENT_COMMAND_MINIMUM_WRITE_SET_RULE,
    isInterimPacketReference,
    type AgentCommandLedgerCategory,
    type AgentCommandLedgerClosure,
    type AgentCommandLedgerEntry,
    type AgentCommandLedgerOwner,
} from '../models/AgentCommandLedger';

import { executableAppActionDescriptorByType, isExecutableAppActionType } from './executableAppActionRegistry';
import { getAppActionPreviewExecution } from './getAppActionPreviewExecution';

type AgentCommandLedgerEntryDto = {
    operationId: string;
    category: AgentCommandLedgerCategory;
    owner: AgentCommandLedgerOwner;
    descriptorVersion: number;
    packet: string;
    closure: AgentCommandLedgerClosure;
    minimumWriteSet: boolean;
    previewExecution: 'isolated-project' | 'unsupported-external' | 'unknown';
};

type AgentCommandLedgerDto = {
    schemaVersion: number;
    entries: readonly AgentCommandLedgerEntryDto[];
    uncoveredCategories: readonly { category: AgentCommandLedgerCategory; packet: string; reason: string }[];
};

function isMinimumWriteSet(operationId: string): boolean {
    const descriptor = executableAppActionDescriptorByType.get(operationId);
    if (!descriptor) {
        return false;
    }
    const discoverability = 'discoverability' in descriptor ? (descriptor.discoverability ?? 'visible') : 'visible';
    return (
        descriptor.risk === AGENT_COMMAND_MINIMUM_WRITE_SET_RULE.risk &&
        discoverability === AGENT_COMMAND_MINIMUM_WRITE_SET_RULE.discoverability
    );
}

function readPreviewExecution(operationId: string): AgentCommandLedgerEntryDto['previewExecution'] {
    if (!isExecutableAppActionType(operationId)) {
        return 'unknown';
    }
    return getAppActionPreviewExecution(operationId);
}

/**
 * Fails fast when a ledger entry's packet format disagrees with its closure, so the published
 * ledger never carries a `supported` entry pointing at a tracker packet or an `interim-unsupported`
 * entry pointing at a handler factory name.
 */
function assertPacketMatchesClosure(entry: AgentCommandLedgerEntry): AgentCommandLedgerEntry {
    const packetIsTrackerReference = isInterimPacketReference(entry.packet);
    const shouldBeTrackerReference = entry.closure === 'interim-unsupported';
    if (packetIsTrackerReference !== shouldBeTrackerReference) {
        throw new Error(
            `AGENT_COMMAND_LEDGER entry '${entry.operationId}' has packet '${entry.packet}', which disagrees with its closure '${entry.closure}'.`
        );
    }
    return entry;
}

/**
 * Publishes the derived agent command ledger: one entry per registered executable command, each
 * carrying its category, owning handler module, descriptor version, implementation packet,
 * whether it qualifies for the minimum write set an agent may commit without explicit
 * confirmation, and its preview execution capability. `previewExecution` reads
 * `getAppActionPreviewExecution`, so it reflects the handlers registered at call time, not a
 * static property of the ledger entry — the same operationId can answer differently across calls
 * if the caller registers or clears handler maps in between.
 */
export function getAgentCommandLedger(): AgentCommandLedgerDto {
    return {
        schemaVersion: AGENT_COMMAND_LEDGER_SCHEMA_VERSION,
        entries: AGENT_COMMAND_LEDGER.map(assertPacketMatchesClosure).map((entry) => ({
            ...entry,
            minimumWriteSet: isMinimumWriteSet(entry.operationId),
            previewExecution: readPreviewExecution(entry.operationId),
        })),
        uncoveredCategories: AGENT_COMMAND_LEDGER_UNCOVERED_CATEGORIES,
    };
}
