import {
    type AgentPlanUncertainty,
    type AgentRunBudgets,
    type AgentRunGrants,
    type AgentRunPlan,
    type AgentRunPlanAlternative,
    type AgentRunProviderProposal,
    type AgentRunScope,
} from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { RUNTIME_ACTION_TYPES } from '../models/RuntimeAction';

type AgentRunSemanticEvidence = { uncertainty: AgentPlanUncertainty[] };

type PlanAgentRunInput = {
    request: string;
    revision: string;
    actions: readonly { type: string }[];
    actionLabels: readonly string[];
    scope: AgentRunScope;
    grants: AgentRunGrants;
    budgets: AgentRunBudgets;
    requiresConfirmation: boolean;
    applicationToolReceipts?: readonly ApplicationToolReceipt[];
    providerProposal?: AgentRunProviderProposal;
    /**
     * Target ids this batch mints for objects that do not exist yet. The application assigns them
     * after the provider has already answered, so no proposal can name them and they are excluded
     * from both sides of the scope comparison below.
     */
    applicationAssignedTargetIds?: readonly string[];
    /** Provider-originated actions cannot reach plan persistence without semantic evidence. */
    requireProviderProposal?: boolean;
    readyAssetIds?: readonly string[];
    semanticEvidence?: AgentRunSemanticEvidence;
};

type PlanAgentRunResult =
    | { status: 'planned'; plan: AgentRunPlan }
    | {
          status: 'needs-user-decision';
          decision: { alternatives: AgentRunPlanAlternative[]; reason: string };
      }
    | { status: 'rejected'; reason: string };

function sameScope(left: AgentRunScope, right: AgentRunScope): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function compareTargetIds(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

function compareRanges(
    left: AgentRunScope['targetRanges'][number],
    right: AgentRunScope['targetRanges'][number]
): number {
    return left.startBeat - right.startBeat || left.endBeat - right.endBeat;
}

/**
 * The portion of a scope a provider can declare, in one canonical form: the ids the application
 * mints for this batch are removed, every list is sorted, and both sides are rebuilt in the same
 * key order. The application derives list order from its own batch compilation, so a provider
 * cannot reproduce it; only membership carries authority, and sorting leaves membership strict
 * because it preserves every entry, duplicates included.
 */
function getProviderKnowableScope(scope: AgentRunScope, applicationAssignedTargetIds: ReadonlySet<string>) {
    return {
        targetIds: scope.targetIds
            .filter((targetId) => !applicationAssignedTargetIds.has(targetId))
            .sort(compareTargetIds),
        targetRanges: [...scope.targetRanges].sort(compareRanges),
        protectedTargetIds: [...scope.protectedTargetIds].sort(compareTargetIds),
        protectedRanges: [...scope.protectedRanges].sort(compareRanges),
    };
}

function isComplex(input: PlanAgentRunInput): boolean {
    return (
        input.actions.length > 1 ||
        input.scope.targetIds.length > 1 ||
        input.scope.targetRanges.length > 0 ||
        input.requiresConfirmation ||
        (input.semanticEvidence?.uncertainty.length ?? 0) > 0 ||
        (input.applicationToolReceipts?.length ?? 0) > 0
    );
}

function deriveCapabilities(input: PlanAgentRunInput): AgentRunPlan['capabilities'] {
    const capabilities: AgentRunPlan['capabilities'] = input.actions.map((action) => {
        const allowed = input.grants.allowedOperationPrefixes.some(
            (prefix) => action.type.startsWith(prefix) || prefix.startsWith(action.type)
        );
        return {
            id: action.type,
            source: 'action-catalog',
            prerequisite: allowed
                ? `The validated run grant admits ${action.type} for this revision.`
                : `No validated run grant admits ${action.type}.`,
            status: allowed ? 'available' : 'unavailable',
        };
    });
    for (const receipt of input.applicationToolReceipts ?? []) {
        capabilities.push({
            id: receipt.toolName,
            source: 'application-tool-catalog',
            prerequisite: `Application tool ${receipt.toolName} returned ${receipt.status}.`,
            status: receipt.status === 'success' ? 'available' : 'unavailable',
        });
    }
    for (const [category, limit] of Object.entries(input.budgets.limits)) {
        capabilities.push({
            id: `budget:${category}`,
            source: 'budget',
            prerequisite: `Budget ${category} is limited to ${limit}; ${input.budgets.consumed[category] ?? 0} is already consumed.`,
            status: limit === 0 || (input.budgets.consumed[category] ?? 0) < limit ? 'required' : 'unavailable',
        });
    }
    const requiredAssetIds = new Set(input.providerProposal?.assetIds ?? []);
    if (input.actions.some((action) => action.type === 'importStemSet')) {
        requiredAssetIds.add('selected-stem-assets');
    }
    const readyAssetIds = new Set(input.readyAssetIds ?? []);
    for (const assetId of requiredAssetIds) {
        capabilities.push({
            id: assetId,
            source: 'asset',
            prerequisite: `Application asset readiness for ${assetId} is required before this run.`,
            status: readyAssetIds.has(assetId) ? 'available' : 'unavailable',
        });
    }
    const requiresRemoteGeneration = input.providerProposal?.capabilityIds?.includes('remote-generation') ?? false;
    capabilities.push({
        id: 'remote-generation-policy',
        source: 'data-policy',
        prerequisite: input.grants.remoteGeneration
            ? 'Remote generation is explicitly granted for this run.'
            : 'Remote generation is not granted and cannot be added by the provider.',
        status: requiresRemoteGeneration && !input.grants.remoteGeneration ? 'unavailable' : 'available',
    });
    return capabilities;
}

export function planAgentRun(input: PlanAgentRunInput): PlanAgentRunResult {
    if (input.requireProviderProposal && input.providerProposal === undefined) {
        return {
            status: 'rejected',
            reason: 'Provider semantic proposal is required before application planning can prove its interpretation.',
        };
    }
    if (input.actions.length !== input.actionLabels.length) {
        return { status: 'rejected', reason: 'Provider actions must have one canonical application label each.' };
    }
    if (
        input.actions.some(
            (action) => !RUNTIME_ACTION_TYPES.includes(action.type as (typeof RUNTIME_ACTION_TYPES)[number])
        )
    ) {
        return { status: 'rejected', reason: 'Provider proposed an unsupported application capability.' };
    }
    const applicationAssignedTargetIds = new Set(input.applicationAssignedTargetIds ?? []);
    if (
        input.providerProposal?.scope &&
        !sameScope(
            getProviderKnowableScope(input.providerProposal.scope, applicationAssignedTargetIds),
            getProviderKnowableScope(input.scope, applicationAssignedTargetIds)
        )
    ) {
        return { status: 'rejected', reason: 'Provider attempted to enlarge or omit the application-owned scope.' };
    }
    const capabilities = deriveCapabilities(input);
    if (capabilities.some((capability) => capability.status === 'unavailable')) {
        return {
            status: 'rejected',
            reason: 'A validated capability, budget, asset, or data-policy prerequisite is unavailable.',
        };
    }
    if (
        input.providerProposal?.capabilityIds?.some(
            (capabilityId) =>
                capabilityId !== 'remote-generation' &&
                !capabilities.some((capability) => capability.id === capabilityId)
        )
    ) {
        return { status: 'rejected', reason: 'Provider proposed a capability outside the application catalog.' };
    }
    const alternatives = input.providerProposal?.alternatives ?? [];
    const uncertainty = input.providerProposal?.semantic?.uncertainty ?? input.semanticEvidence?.uncertainty ?? [];
    if (alternatives.some((alternative) => alternative.changesAuthority)) {
        return {
            status: 'needs-user-decision',
            decision: {
                alternatives,
                reason: 'The alternatives would change the authority or outcome of this run.',
            },
        };
    }
    const complex = input.providerProposal?.semantic?.classification === 'complex' || isComplex(input);
    const actionDescriptions = input.actionLabels.map((label, index) => ({
        order: index + 1,
        actionType: input.actions[index]!.type,
        description: label,
    }));
    return {
        status: 'planned',
        plan: {
            summary: input.actionLabels.join('\n'),
            commandIds: [],
            serializedBatchIdentity: null,
            applicationToolReceipts: structuredClone([...(input.applicationToolReceipts ?? [])]),
            revision: input.revision,
            classification: complex ? 'complex' : 'simple',
            showPlanPanel: complex,
            objective: input.providerProposal?.objective ?? input.request,
            interpretedConstraints: [
                `Plan is bound to project revision ${input.revision}.`,
                ...(input.providerProposal?.constraints ?? []),
                ...uncertainty.map((entry) => `Structured uncertainty: ${entry}.`),
                ...input.scope.protectedTargetIds.map((targetId) => `Protect ${targetId}.`),
            ],
            scope: structuredClone(input.scope),
            steps: actionDescriptions,
            expectedImpact: {
                project: actionDescriptions.map((step) => step.description),
                audible: {
                    status: 'not-claimed',
                    reason: 'The application plans state changes but does not infer or claim that it listened to audio.',
                },
            },
            capabilities,
            risks: input.requiresConfirmation ? ['The compiled command policy requires explicit confirmation.'] : [],
            approvalPoints: input.requiresConfirmation
                ? [
                      {
                          kind: 'command-confirmation',
                          reason: 'Command risk policy requires confirmation before mutation.',
                      },
                  ]
                : [],
            validationStrategy: [
                `Revalidate project revision ${input.revision} before confirmation or execution.`,
                'Validate each action against the registered application action catalog and compiled command authority.',
                ...(input.providerProposal?.validationStrategy ?? []),
            ],
            stoppingConditions: [
                'Stop before mutation if the project revision changes.',
                'Stop before mutation if capability, asset, budget, or command authority validation fails.',
                'Stop when the approved command batch reaches a terminal receipt.',
                ...(input.providerProposal?.stoppingConditions ?? []),
            ],
            alternatives,
            needsUserDecision: false,
        },
    };
}
