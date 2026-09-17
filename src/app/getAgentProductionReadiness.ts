import { getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';
import { getAgentCommandLedger } from '#/modules/Command/useCases';

import { getAgentProtocolManifest } from './getAgentProtocolManifest';

/** Structurally mirrors the manifest contract shape `getAgentProtocolManifest` publishes. */
type AgentProtocolContractLike = {
    id: string;
    owner: string;
    schemaVersion: number;
    capabilities: readonly string[];
    operations: ReadonlyArray<{ name: string; version: string; availability: string }>;
    availability: string;
    compatibility: {
        mode: 'migrate' | 'read-only-preserve' | 'reject-unsupported' | 'discard-retired';
        behavior: string;
        canonicalProjectRequiresCommandReplay: false;
    };
};

export const AGENT_PRODUCTION_PHASES = [
    'command-query-extraction',
    'read-only-assistance',
    'previewable-basic-edits',
    'batches-and-transforms',
    'offline-render-measurement',
    'vibe-mix-planning',
    'media-autonomy-exclusion',
    'external-adapters',
] as const;

export type AgentProductionPhaseId = (typeof AGENT_PRODUCTION_PHASES)[number];

type AgentProductionPhaseGate = 'passed' | 'failed';
type AgentProductionPhaseStatus = 'passed' | 'failed' | 'blocked';

export type AgentProductionPhaseResult = {
    id: AgentProductionPhaseId;
    gate: AgentProductionPhaseGate;
    status: AgentProductionPhaseStatus;
    blockedBy: AgentProductionPhaseId | null;
};

export type AgentProductionReadinessResult = {
    phases: readonly AgentProductionPhaseResult[];
    completionClaim: boolean;
    completionBlockers: readonly string[];
};

type AgentProductionReadinessInput = {
    manifest: readonly AgentProtocolContractLike[];
    ledger: ReturnType<typeof getAgentCommandLedger>;
    catalog: ReturnType<typeof getAgentCapabilityCatalog>;
};

function findContract(
    manifest: readonly AgentProtocolContractLike[],
    id: string
): AgentProtocolContractLike | undefined {
    return manifest.find((contract) => contract.id === id);
}

function hasAvailableOperation(contract: AgentProtocolContractLike | undefined): boolean {
    return contract?.operations.some((operation) => operation.availability === 'available') ?? false;
}

function passesCommandQueryExtraction(input: AgentProductionReadinessInput): boolean {
    const command = findContract(input.manifest, 'command');
    const query = findContract(input.manifest, 'query');
    return hasAvailableOperation(command) && hasAvailableOperation(query);
}

function passesReadOnlyAssistance(input: AgentProductionReadinessInput): boolean {
    const discovery = findContract(input.manifest, 'discovery');
    if (discovery?.availability !== 'available' || discovery.operations.length === 0) {
        return false;
    }
    return discovery.operations.every((operation) => {
        const catalogEntry = input.catalog.entries.find((entry) => entry.id === `discovery:${operation.name}`);
        return catalogEntry?.availability === 'available';
    });
}

function passesPreviewableBasicEdits(input: AgentProductionReadinessInput): boolean {
    const minimumWriteSetEntries = input.ledger.entries.filter((entry) => entry.minimumWriteSet);
    return (
        minimumWriteSetEntries.length > 0 &&
        minimumWriteSetEntries.every(
            (entry) => entry.closure === 'supported' && entry.previewExecution === 'isolated-project'
        )
    );
}

function passesBatchesAndTransforms(input: AgentProductionReadinessInput): boolean {
    const transform = findContract(input.manifest, 'transform');
    const command = findContract(input.manifest, 'command');
    return transform !== undefined && (command?.capabilities.includes('atomic-batch') ?? false);
}

function passesOfflineRenderMeasurement(input: AgentProductionReadinessInput): boolean {
    const receipt = findContract(input.manifest, 'receipt');
    const hasRenderFreezeExportEntry = input.ledger.entries.some(
        (entry) => entry.category === 'render-freeze-export' && entry.closure === 'supported'
    );
    return receipt?.availability === 'available' && hasRenderFreezeExportEntry;
}

function passesVibeMixPlanning(input: AgentProductionReadinessInput): boolean {
    const productionBrief = findContract(input.manifest, 'production-brief');
    return productionBrief?.availability === 'available';
}

const MEDIA_AUTONOMY_EXCLUDED_CAPABILITIES = [
    'agent.media.listen',
    'agent.media.generate',
    'agent.project.reconstruct',
] as const;

function passesMediaAutonomyExclusion(input: AgentProductionReadinessInput): boolean {
    return MEDIA_AUTONOMY_EXCLUDED_CAPABILITIES.every((name) => {
        const entry = input.catalog.entries.find((candidate) => candidate.name === name);
        return entry?.availability === 'unavailable' && entry.evidence.callable === false;
    });
}

function passesExternalAdapters(input: AgentProductionReadinessInput): boolean {
    return findContract(input.manifest, 'external-adapter')?.availability === 'available';
}

const PHASE_GATES: Record<AgentProductionPhaseId, (input: AgentProductionReadinessInput) => boolean> = {
    'command-query-extraction': passesCommandQueryExtraction,
    'read-only-assistance': passesReadOnlyAssistance,
    'previewable-basic-edits': passesPreviewableBasicEdits,
    'batches-and-transforms': passesBatchesAndTransforms,
    'offline-render-measurement': passesOfflineRenderMeasurement,
    'vibe-mix-planning': passesVibeMixPlanning,
    'media-autonomy-exclusion': passesMediaAutonomyExclusion,
    'external-adapters': passesExternalAdapters,
};

function evaluatePhases(input: AgentProductionReadinessInput): readonly AgentProductionPhaseResult[] {
    const phases: AgentProductionPhaseResult[] = [];
    for (const id of AGENT_PRODUCTION_PHASES) {
        const gate: AgentProductionPhaseGate = PHASE_GATES[id](input) ? 'passed' : 'failed';
        const blockingPhase = phases.find((earlierPhase) => earlierPhase.status !== 'passed');
        if (blockingPhase) {
            phases.push({ id, gate, status: 'blocked', blockedBy: blockingPhase.id });
            continue;
        }
        phases.push({ id, gate, status: gate, blockedBy: null });
    }
    return phases;
}

function collectCompletionBlockers(
    phases: readonly AgentProductionPhaseResult[],
    ledger: ReturnType<typeof getAgentCommandLedger>
): readonly string[] {
    const unmetPhaseBlockers = phases.filter((phase) => phase.status !== 'passed').map((phase) => phase.id);
    const interimUnsupportedBlockers = ledger.entries
        .filter((entry) => entry.closure === 'interim-unsupported')
        .map((entry) => `ledger:interim-unsupported:${entry.operationId}`);
    const uncoveredCategoryBlockers = ledger.uncoveredCategories.map((record) => `ledger:uncovered:${record.category}`);
    return [...unmetPhaseBlockers, ...interimUnsupportedBlockers, ...uncoveredCategoryBlockers].sort();
}

/**
 * Pure evaluation of the production-readiness phase ladder. A phase is `blocked` whenever any
 * earlier phase has not `passed`, regardless of its own gate; `blockedBy` names the earliest such
 * earlier phase. `completionClaim` requires every phase `passed`, no `interim-unsupported` ledger
 * entry, and an empty `uncoveredCategories` list.
 */
export function evaluateAgentProductionReadiness(input: AgentProductionReadinessInput): AgentProductionReadinessResult {
    const phases = evaluatePhases(input);
    const completionBlockers = collectCompletionBlockers(phases, input.ledger);
    const completionClaim = completionBlockers.length === 0 && phases.every((phase) => phase.status === 'passed');
    return { phases, completionClaim, completionBlockers };
}

/** Composes the live manifest, command ledger, and capability catalog and evaluates readiness. */
export function getAgentProductionReadiness(): AgentProductionReadinessResult {
    const manifest = getAgentProtocolManifest();
    const ledger = getAgentCommandLedger();
    const catalog = getAgentCapabilityCatalog(manifest);
    return evaluateAgentProductionReadiness({ manifest, ledger, catalog });
}
