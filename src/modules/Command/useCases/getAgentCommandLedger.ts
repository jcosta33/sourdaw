import {
    AGENT_COMMAND_LEDGER,
    AGENT_COMMAND_LEDGER_SCHEMA_VERSION,
    AGENT_COMMAND_LEDGER_UNCOVERED_CATEGORIES,
    AGENT_COMMAND_MINIMUM_WRITE_SET_RULE,
    type AgentCommandLedgerCategory,
    type AgentCommandLedgerClosure,
    type AgentCommandLedgerOwner,
} from '../models/AgentCommandLedger';

import { executableAppActionDescriptorByType } from './executableAppActionRegistry';

type AgentCommandLedgerEntryDto = {
    operationId: string;
    category: AgentCommandLedgerCategory;
    owner: AgentCommandLedgerOwner;
    descriptorVersion: number;
    packet: string;
    closure: AgentCommandLedgerClosure;
    minimumWriteSet: boolean;
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

/**
 * Publishes the derived agent command ledger: one entry per registered executable command, each
 * carrying its category, owning handler module, descriptor version, implementation packet, and
 * whether it qualifies for the minimum write set an agent may commit without explicit confirmation.
 */
export function getAgentCommandLedger(): AgentCommandLedgerDto {
    return {
        schemaVersion: AGENT_COMMAND_LEDGER_SCHEMA_VERSION,
        entries: AGENT_COMMAND_LEDGER.map((entry) => ({
            ...entry,
            minimumWriteSet: isMinimumWriteSet(entry.operationId),
        })),
        uncoveredCategories: AGENT_COMMAND_LEDGER_UNCOVERED_CATEGORIES,
    };
}
