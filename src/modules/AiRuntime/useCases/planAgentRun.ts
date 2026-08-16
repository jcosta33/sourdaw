import {
    type AgentRunBudgets,
    type AgentRunGrants,
    type AgentRunPlan,
    type AgentRunPlanAlternative,
    type AgentRunProviderProposal,
    type AgentRunScope,
} from '../models/AgentRun';
import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';
import { RUNTIME_ACTION_TYPES } from '../models/RuntimeAction';

type AgentRunSemanticEvidence = {
    uncertainty: Array<'ambiguous-target' | 'exploratory-outcome' | 'conflicted-constraints' | 'capability-mismatch'>;
};

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
        const allowed =
            !input.requiresConfirmation ||
            input.grants.allowedOperationPrefixes.length === 0 ||
            input.grants.allowedOperationPrefixes.some(
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
    if (input.actions.some((action) => action.type === 'importStemSet')) {
        capabilities.push({
            id: 'selected-stem-assets',
            source: 'asset',
            prerequisite: 'The user-selected stem assets remain prepared for this run.',
            status: 'required',
        });
    }
    capabilities.push({
        id: 'remote-generation-policy',
        source: 'data-policy',
        prerequisite: input.grants.remoteGeneration
            ? 'Remote generation is explicitly granted for this run.'
            : 'Remote generation is not granted and cannot be added by the provider.',
        status: 'available',
    });
    return capabilities;
}

export function planAgentRun(input: PlanAgentRunInput): PlanAgentRunResult {
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
    if (input.providerProposal?.scope && !sameScope(input.providerProposal.scope, input.scope)) {
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
            (capabilityId) => !capabilities.some((capability) => capability.id === capabilityId)
        )
    ) {
        return { status: 'rejected', reason: 'Provider proposed a capability outside the application catalog.' };
    }
    const alternatives = input.providerProposal?.alternatives ?? [];
    const uncertainty = input.providerProposal?.uncertainty ?? input.semanticEvidence?.uncertainty ?? [];
    if (alternatives.some((alternative) => alternative.changesAuthority)) {
        return {
            status: 'needs-user-decision',
            decision: {
                alternatives,
                reason: 'The alternatives would change the authority or outcome of this run.',
            },
        };
    }
    const complex = isComplex(input);
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
            objective: input.request,
            interpretedConstraints: [
                `Plan is bound to project revision ${input.revision}.`,
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
            ],
            stoppingConditions: [
                'Stop before mutation if the project revision changes.',
                'Stop before mutation if capability, asset, budget, or command authority validation fails.',
                'Stop when the approved command batch reaches a terminal receipt.',
            ],
            alternatives,
            needsUserDecision: false,
        },
    };
}
