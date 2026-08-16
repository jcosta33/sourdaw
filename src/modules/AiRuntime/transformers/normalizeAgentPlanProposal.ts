import {
    AGENT_PLAN_UNCERTAINTY,
    type AgentPlanProposal,
    type AgentRunPlanAlternative,
    type AgentRunScope,
} from '../models/AgentRun';

const MAX_PLAN_TEXT_ITEMS = 32;
const MAX_PLAN_TEXT_LENGTH = 512;
const MAX_SCOPE_IDS = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTextList(value: unknown, limit = MAX_PLAN_TEXT_ITEMS): string[] | null {
    if (!Array.isArray(value) || value.length > limit) {
        return null;
    }
    const values = value.map((entry) =>
        typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_PLAN_TEXT_LENGTH ? entry : null
    );
    return values.every((entry) => entry !== null) ? values : null;
}

function normalizeScope(value: unknown): AgentRunScope | null {
    if (!isRecord(value)) {
        return null;
    }
    const targetIds = normalizeTextList(value.targetIds, MAX_SCOPE_IDS);
    const protectedTargetIds = normalizeTextList(value.protectedTargetIds, MAX_SCOPE_IDS);
    const normalizeRanges = (ranges: unknown) => {
        if (!Array.isArray(ranges) || ranges.length > MAX_SCOPE_IDS) {
            return null;
        }
        const normalized = ranges.map((range) =>
            isRecord(range) &&
            typeof range.startBeat === 'number' &&
            Number.isFinite(range.startBeat) &&
            typeof range.endBeat === 'number' &&
            Number.isFinite(range.endBeat) &&
            range.endBeat > range.startBeat
                ? { startBeat: range.startBeat, endBeat: range.endBeat }
                : null
        );
        return normalized.every((range) => range !== null) ? normalized : null;
    };
    const targetRanges = normalizeRanges(value.targetRanges);
    const protectedRanges = normalizeRanges(value.protectedRanges);
    return targetIds && protectedTargetIds && targetRanges && protectedRanges
        ? { targetIds, targetRanges, protectedTargetIds, protectedRanges }
        : null;
}

function normalizeAlternatives(value: unknown): AgentRunPlanAlternative[] | null {
    if (!Array.isArray(value) || value.length > MAX_PLAN_TEXT_ITEMS) {
        return null;
    }
    const alternatives = value.map((alternative) =>
        isRecord(alternative) &&
        typeof alternative.id === 'string' &&
        alternative.id.length > 0 &&
        alternative.id.length <= 128 &&
        typeof alternative.label === 'string' &&
        alternative.label.length > 0 &&
        alternative.label.length <= MAX_PLAN_TEXT_LENGTH &&
        typeof alternative.changesAuthority === 'boolean'
            ? { id: alternative.id, label: alternative.label, changesAuthority: alternative.changesAuthority }
            : null
    );
    return alternatives.every((alternative) => alternative !== null) ? alternatives : null;
}

export function normalizeAgentPlanProposal(value: unknown): AgentPlanProposal | null {
    if (!isRecord(value) || !isRecord(value.semantic)) {
        return null;
    }
    const uncertainty = normalizeTextList(value.semantic.uncertainty);
    const constraints = normalizeTextList(value.constraints);
    const capabilityIds = normalizeTextList(value.capabilityIds);
    const assetIds = normalizeTextList(value.assetIds);
    const validationStrategy = normalizeTextList(value.validationStrategy);
    const stoppingConditions = normalizeTextList(value.stoppingConditions);
    const scope = normalizeScope(value.scope);
    const alternatives = normalizeAlternatives(value.alternatives);
    if (
        (value.semantic.classification !== 'simple' && value.semantic.classification !== 'complex') ||
        uncertainty === null ||
        uncertainty.some(
            (entry) => !AGENT_PLAN_UNCERTAINTY.includes(entry as (typeof AGENT_PLAN_UNCERTAINTY)[number])
        ) ||
        typeof value.objective !== 'string' ||
        value.objective.length === 0 ||
        value.objective.length > MAX_PLAN_TEXT_LENGTH ||
        constraints === null ||
        capabilityIds === null ||
        assetIds === null ||
        validationStrategy === null ||
        stoppingConditions === null ||
        scope === null ||
        alternatives === null
    ) {
        return null;
    }
    return {
        semantic: {
            classification: value.semantic.classification,
            uncertainty: uncertainty as AgentPlanProposal['semantic']['uncertainty'],
        },
        objective: value.objective,
        constraints,
        scope,
        capabilityIds,
        assetIds,
        alternatives,
        validationStrategy,
        stoppingConditions,
    };
}

export function extractAgentPlanProposal(
    toolCalls: readonly { name: string; arguments: Record<string, unknown> }[]
): AgentPlanProposal | null {
    const proposalCalls = toolCalls.filter((call) => call.name === 'command.batch.propose');
    if (proposalCalls.length !== 1) {
        return null;
    }
    return normalizeAgentPlanProposal(proposalCalls[0]!.arguments.plan);
}

/**
 * Canonical identity for the provider interpretation plus the application-owned
 * authority derived from it. Resume binds this value before a replacement
 * provider attempt and recomputes it after that attempt's shared normalization.
 */
export function getAgentPlanProposalIdentity(input: {
    actions: unknown;
    providerProposal: unknown;
    scope: {
        targetIds: readonly string[];
        targetRanges: readonly { startBeat: number; endBeat: number }[];
        protectedTargetIds: readonly string[];
        protectedRanges: readonly { startBeat: number; endBeat: number }[];
    };
    grants: {
        allowedOperationPrefixes: readonly string[];
        create: boolean;
        delete: boolean;
        routing: boolean;
        tempo: boolean;
        master: boolean;
        file: boolean;
        audioUpload: boolean;
        remoteGeneration: boolean;
        autoCommit: boolean;
    };
}): string {
    const proposal = input.providerProposal === null ? null : normalizeAgentPlanProposal(input.providerProposal);
    if (input.providerProposal !== null && proposal === null) {
        throw new Error('Agent plan proposal failed shared normalization.');
    }
    return JSON.stringify({
        actions: input.actions,
        providerProposal: proposal,
        scope: {
            targetIds: [...input.scope.targetIds],
            targetRanges: input.scope.targetRanges.map((range) => ({ ...range })),
            protectedTargetIds: [...input.scope.protectedTargetIds],
            protectedRanges: input.scope.protectedRanges.map((range) => ({ ...range })),
        },
        grants: {
            allowedOperationPrefixes: [...input.grants.allowedOperationPrefixes],
            create: input.grants.create,
            delete: input.grants.delete,
            routing: input.grants.routing,
            tempo: input.grants.tempo,
            master: input.grants.master,
            file: input.grants.file,
            audioUpload: input.grants.audioUpload,
            remoteGeneration: input.grants.remoteGeneration,
            autoCommit: input.grants.autoCommit,
        },
    });
}

export function createDeterministicAgentPlanProposal(input: {
    objective: string;
    scope: AgentRunScope;
    capabilityIds: string[];
    assetIds?: string[];
}): AgentPlanProposal {
    return {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: input.objective,
        constraints: [],
        scope: structuredClone(input.scope),
        capabilityIds: [...input.capabilityIds],
        assetIds: [...(input.assetIds ?? [])],
        alternatives: [],
        validationStrategy: ['Validate the registered application action catalog before execution.'],
        stoppingConditions: ['Stop before mutation if application authority validation fails.'],
    };
}
