import { generateGroupId, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { type AgentExecutionMode, type AgentTrustCeiling } from '../../models/AgentExecutionMode';
import { type AgentRunDecisionResume, type AgentRunScope } from '../../models/AgentRun';
import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { updateChatMessage } from '../../stores/chatStore';
import { getAgentPlanProposalIdentity } from '../../transformers/normalizeAgentPlanProposal';
import { createStemImportConfirmationResourceLease } from '../agentReference/createStemImportConfirmationResourceLease';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { compileAgentActionExecution } from '../compileAgentActionExecution';
import { planAgentRun } from '../planAgentRun';
import { getPlanningProviderSchemaContract } from '../planningProviderSchema';

import type { planPromptActions } from '../planPromptActions';

type ProviderKnownScopeInput = {
    readonly targetRanges: readonly Readonly<AgentRunScope['targetRanges'][number]>[];
    readonly protectedTargetIds: readonly string[];
    readonly protectedRanges: readonly Readonly<AgentRunScope['protectedRanges'][number]>[];
};

type CompiledCommandBatchAuthority = ReturnType<typeof compileAgentActionExecution>['commandBatch']['authority'];

type MaterializePromptCommandPlanInput = {
    userText: string;
    runId: string;
    assistantMessageId: string;
    interactionMode: Exclude<AgentExecutionMode, 'explain'>;
    trustCeiling: AgentTrustCeiling | undefined;
    resume: AgentRunDecisionResume | undefined;
    onResumedPlanAccepted: (() => void) | undefined;
    projectRevision: string;
    context: Awaited<ReturnType<typeof planPromptActions>>['context'];
    result: Awaited<ReturnType<typeof planPromptActions>>['result'];
    actionLabels: readonly string[];
    protectedTargetIds: readonly string[];
};

function assertResumedProposalIdentity(
    input: { proposalIdentity: string } | undefined,
    value: Parameters<typeof getAgentPlanProposalIdentity>[0]
): void {
    const proposalIdentity = getAgentPlanProposalIdentity(value);
    if (input && proposalIdentity !== input.proposalIdentity) {
        throw new Error('The replacement provider plan no longer matches the selected decision interpretation.');
    }
}

/** The ids this batch mints for objects that did not exist when the provider answered. */
function getApplicationAssignedTargetIds(
    envelope: Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>['envelope']
): string[] {
    return envelope.preconditions.flatMap((precondition) =>
        precondition.kind === 'targets-absent' ? [...(precondition.targetIds ?? [])] : []
    );
}

function getProviderKnownScope(
    scope: ProviderKnownScopeInput,
    providerKnownTargetIds: readonly string[] | undefined
): AgentRunScope | undefined {
    if (providerKnownTargetIds === undefined) {
        return undefined;
    }
    return {
        targetIds: [...providerKnownTargetIds],
        targetRanges: scope.targetRanges.map((range) => ({ ...range })),
        protectedTargetIds: [...scope.protectedTargetIds],
        protectedRanges: scope.protectedRanges.map((range) => ({ ...range })),
    };
}

const SELECTED_STEM_ASSETS_READY_ID = 'selected-stem-assets';

function getApplicationReadyAssetIdsForPlan(runId: string, actions: readonly ExecutableRuntimeAction[]): string[] {
    const selectedStems = actions.flatMap((action) => (action.type === 'importStemSet' ? action.payload.stems : []));
    const selectedStemAssetIds = selectedStems.map((stem) => stem.audioBufferId);
    if (selectedStemAssetIds.length === 0) {
        return [];
    }

    const livePreparedStemAssetIds = new Set(
        agentRunLifecycle
            .get(runId)
            ?.temporaryAssets.flatMap((asset) =>
                asset.kind === 'import' && asset.status === 'live' ? [asset.assetId] : []
            ) ?? []
    );
    if (
        livePreparedStemAssetIds.size !== selectedStemAssetIds.length ||
        selectedStemAssetIds.some((assetId) => !livePreparedStemAssetIds.has(assetId))
    ) {
        return [];
    }

    return [SELECTED_STEM_ASSETS_READY_ID, ...new Set(selectedStems.map((stem) => stem.stemId))];
}

function cloneScope(scope: CompiledCommandBatchAuthority['scope']): AgentRunScope {
    return {
        targetIds: [...scope.targetIds],
        targetRanges: scope.targetRanges.map((range) => ({ ...range })),
        protectedTargetIds: [...scope.protectedTargetIds],
        protectedRanges: scope.protectedRanges.map((range) => ({ ...range })),
    };
}

function cloneGrants(grants: CompiledCommandBatchAuthority['grants']): AgentRunDecisionResume['grants'] {
    return {
        ...grants,
        allowedOperationPrefixes: [...grants.allowedOperationPrefixes],
    };
}

export function materializePromptCommandPlan(input: MaterializePromptCommandPlanInput) {
    const admittedRun = agentRunLifecycle.get(input.runId);
    if (!admittedRun) {
        throw new Error('Agent run disappeared before plan materialization.');
    }

    const commandGroup = generateGroupId(input.userText);
    const readyAssetIds = getApplicationReadyAssetIdsForPlan(input.runId, input.result.actions);
    const compile = (mode: Exclude<AgentExecutionMode, 'explain' | 'plan'>) =>
        compileAgentActionExecution({
            actions: input.result.actions,
            actionCommandGraph: input.result.actionCommandGraph,
            actionLabels: input.actionLabels,
            context: input.context,
            group: commandGroup,
            intent: input.userText,
            projectRevision: input.projectRevision,
            requiresConfirmation: input.result.requiresConfirmation,
            runId: input.runId,
            mode,
            protectedTargetIds: [...input.protectedTargetIds],
            trustCeiling: input.trustCeiling,
        });

    if (input.interactionMode === 'plan') {
        const plannedCommandBatch = compile('apply').commandBatch;
        const parsedPlannedBatch = parseVersionedCommandBatchEnvelope(
            plannedCommandBatch.serialized,
            plannedCommandBatch.authority
        );
        if (parsedPlannedBatch.status === 'invalid') {
            throw new Error(parsedPlannedBatch.reason);
        }
        const planScope = cloneScope(plannedCommandBatch.authority.scope);
        const planGrants = cloneGrants(plannedCommandBatch.authority.grants);
        assertResumedProposalIdentity(input.resume, {
            actions: input.result.actions,
            providerProposal: input.result.providerProposal ?? null,
            scope: planScope,
            grants: planGrants,
        });
        const plannedRun = planAgentRun({
            request: input.userText,
            revision: input.projectRevision,
            actions: input.result.actions,
            actionLabels: input.actionLabels,
            scope: planScope,
            grants: planGrants,
            budgets: admittedRun.budgets,
            requiresConfirmation: false,
            applicationToolReceipts: input.result.applicationToolReceipts,
            providerProposal: input.result.providerProposal,
            providerKnownScope: getProviderKnownScope(planScope, input.result.providerKnownTargetIds),
            requireProviderProposal: input.result.executionMode === 'atomic',
            applicationAssignedTargetIds: getApplicationAssignedTargetIds(parsedPlannedBatch.envelope),
            readyAssetIds,
        });
        if (plannedRun.status === 'needs-user-decision') {
            const completion = (async () => {
                await createStemImportConfirmationResourceLease(input.result.actions)?.releaseBestEffort();
                agentRunLifecycle.requireManualResume({
                    runId: input.runId,
                    reason: plannedRun.decision.reason,
                    workIds: [],
                });
                agentRunLifecycle.recordDecision({
                    runId: input.runId,
                    decision: {
                        decisionId: crypto.randomUUID(),
                        capabilitySchemaIdentity: getPlanningProviderSchemaContract().identity,
                        proposalIdentity: getAgentPlanProposalIdentity({
                            actions: input.result.actions,
                            providerProposal: input.result.providerProposal ?? null,
                            scope: planScope,
                            grants: planGrants,
                        }),
                        budgets: admittedRun.budgets,
                        revision: input.projectRevision,
                        scope: planScope,
                        grants: planGrants,
                        alternatives: plannedRun.decision.alternatives,
                        reason: plannedRun.decision.reason,
                        selectedAlternativeId: null,
                        resumeAttemptId: null,
                    },
                });
                updateChatMessage(input.assistantMessageId, {
                    isStreaming: false,
                    content: `Choose one before I continue:\n\n${plannedRun.decision.alternatives.map((alternative) => `- ${alternative.label}`).join('\n')}`,
                });
            })();
            return { status: 'terminal' as const, completion };
        }
        if (plannedRun.status === 'rejected') {
            throw new Error(plannedRun.reason);
        }
        input.onResumedPlanAccepted?.();
        agentRunLifecycle.recordPlan({
            runId: input.runId,
            summary: input.actionLabels.join('\n'),
            commandIds: [],
            serializedBatchIdentity: null,
            applicationToolReceipts: input.result.applicationToolReceipts ?? [],
            revision: input.projectRevision,
            scope: planScope,
            grants: planGrants,
            budgets: admittedRun.budgets,
            plan: plannedRun.plan,
        });
        agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'completed' });
        const completion = (async () => {
            await createStemImportConfirmationResourceLease(input.result.actions)?.releaseBestEffort();
            updateChatMessage(input.assistantMessageId, {
                isStreaming: false,
                content: `Planned without changing the project:\n\n${input.actionLabels.map((label) => `- ${label}`).join('\n')}`,
            });
        })();
        return { status: 'terminal' as const, completion };
    }

    const compiledActionExecution = compile(input.interactionMode);
    const { commandBatch } = compiledActionExecution;
    const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedCommandBatch.status === 'invalid') {
        throw new Error(parsedCommandBatch.reason);
    }
    const commandIds = parsedCommandBatch.envelope.commands.map((command) => command.commandId);
    const planScope = cloneScope(commandBatch.authority.scope);
    const planGrants = cloneGrants(commandBatch.authority.grants);
    assertResumedProposalIdentity(input.resume, {
        actions: input.result.actions,
        providerProposal: input.result.providerProposal ?? null,
        scope: planScope,
        grants: planGrants,
    });
    const plannedRun = planAgentRun({
        request: input.userText,
        revision: input.projectRevision,
        actions: input.result.actions,
        actionLabels: input.actionLabels,
        scope: planScope,
        grants: planGrants,
        budgets: admittedRun.budgets,
        requiresConfirmation: compiledActionExecution.requiresConfirmation,
        applicationToolReceipts: input.result.applicationToolReceipts,
        providerProposal: input.result.providerProposal,
        providerKnownScope: getProviderKnownScope(planScope, input.result.providerKnownTargetIds),
        requireProviderProposal: input.result.executionMode === 'atomic',
        applicationAssignedTargetIds: getApplicationAssignedTargetIds(parsedCommandBatch.envelope),
        readyAssetIds,
    });
    if (plannedRun.status === 'needs-user-decision') {
        input.onResumedPlanAccepted?.();
        const completion = (async () => {
            await createStemImportConfirmationResourceLease(input.result.actions)?.releaseBestEffort();
            agentRunLifecycle.requireManualResume({
                runId: input.runId,
                reason: plannedRun.decision.reason,
                workIds: [],
            });
            agentRunLifecycle.recordDecision({
                runId: input.runId,
                decision: {
                    decisionId: crypto.randomUUID(),
                    capabilitySchemaIdentity: getPlanningProviderSchemaContract().identity,
                    proposalIdentity: getAgentPlanProposalIdentity({
                        actions: input.result.actions,
                        providerProposal: input.result.providerProposal ?? null,
                        scope: planScope,
                        grants: planGrants,
                    }),
                    budgets: admittedRun.budgets,
                    revision: input.projectRevision,
                    scope: planScope,
                    grants: planGrants,
                    alternatives: plannedRun.decision.alternatives,
                    reason: plannedRun.decision.reason,
                    selectedAlternativeId: null,
                    resumeAttemptId: null,
                },
            });
            updateChatMessage(input.assistantMessageId, {
                isStreaming: false,
                content: `Choose one before I can prepare this run:\n\n${plannedRun.decision.alternatives.map((alternative) => `- ${alternative.label}`).join('\n')}`,
            });
        })();
        return { status: 'terminal' as const, completion };
    }
    if (plannedRun.status === 'rejected') {
        throw new Error(plannedRun.reason);
    }
    input.onResumedPlanAccepted?.();
    agentRunLifecycle.recordPlan({
        runId: input.runId,
        summary: input.actionLabels.join('\n'),
        commandIds,
        serializedBatchIdentity: parsedCommandBatch.envelope.idempotencyKey,
        applicationToolReceipts: input.result.applicationToolReceipts ?? [],
        revision: input.projectRevision,
        scope: planScope,
        grants: planGrants,
        budgets: admittedRun.budgets,
        plan: {
            ...plannedRun.plan,
            commandIds,
            serializedBatchIdentity: parsedCommandBatch.envelope.idempotencyKey,
        },
    });
    agentRunLifecycle.recordBatch({
        runId: input.runId,
        batch: {
            batchId: parsedCommandBatch.envelope.batchId,
            commandIds,
            status: compiledActionExecution.requiresConfirmation ? 'waiting-for-approval' : 'planned',
            receiptIdentity: null,
        },
    });
    return {
        status: 'prepared' as const,
        commandGroup,
        compiledActionExecution,
        parsedCommandBatch,
    };
}
