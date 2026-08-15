import { isAppError } from '#/infra/errors/isAppError';
import {
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { isAiRuntimeConfigurationChangedError } from '../errors/AiRuntimeConfigurationChangedError';
import { createAiRuntimeError } from '../errors/AiRuntimeError';
import { type AgentExecutionMode, type AgentTrustCeiling } from '../models/AgentExecutionMode';
import { type AgentRunWorkLease, type AgentRunWorkTerminalState } from '../models/AgentRun';
import { type ChatMessage } from '../models/Chat';
import { CHAT_SYSTEM_PROMPT } from '../models/ChatSystemPrompt';
import { type RunnableAiBackend } from '../models/LlmOrchestrationTypes';
import {
    type CloudChatCompletionOutcome,
    streamCloudChatCompletion,
} from '../repositories/cloudLlm/cloudInference/streamCloudChatCompletion';
import { getCloudProviderInfo } from '../repositories/cloudLlm/getCloudProviderInfo';
import { isCloudAvailable } from '../repositories/cloudLlm/isCloudAvailable';
import { isNativeEngineReady } from '../repositories/nativeEngine/isNativeEngineReady';
import { streamNativeCompletion } from '../repositories/nativeEngine/streaming';
import { getActiveModelId } from '../repositories/webLlm/getActiveModelId';
import { getLlmEngine } from '../repositories/webLlm/getLlmEngine';
import { aiBackendPreferenceStore } from '../stores/aiBackendPreferenceStore';
import {
    chatStore,
    appendChatMessage,
    updateChatMessage,
    setChatGenerating,
    setActiveAborter,
} from '../stores/chatStore';
import { llmStatusStore } from '../stores/llmStatusStore';
import { proposePendingActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { createStemImportConfirmationResourceLease } from './agentReference/createStemImportConfirmationResourceLease';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentRunCancellation } from './cancelAgentRun';
import { compileAgentActionExecution } from './compileAgentActionExecution';
import { createThinkBlockParser } from './createThinkBlockParser';
import { describeAgentRiskApproval } from './describeAgentRiskApproval';
import { describePendingActionConfirmation } from './describePendingActionConfirmation';
import { executePlannedActions } from './executePlannedActions';
import { getProjectContext } from './getProjectContext';
import { resolveBackend } from './llmOrchestration/backendResolution/helpers';
import { planPromptActions } from './planPromptActions';
import { resolveAgentExecutionMode } from './resolveAgentExecutionMode';

function getBackendModelId(backend: RunnableAiBackend): string {
    if (backend === 'native') {
        return 'native';
    }
    if (backend === 'cloud') {
        return getCloudProviderInfo()?.model ?? 'cloud';
    }
    return getActiveModelId();
}

type SendChatMessageOptions = {
    mode?: AgentExecutionMode;
    trustCeiling?: AgentTrustCeiling;
};

type AgentApplyReceipt = Extract<
    Awaited<ReturnType<typeof executePlannedActions>>,
    { status: 'committed' | 'executed' }
>['receipt'];

function getAgentRunReceiptIdentity(receipt: NonNullable<AgentApplyReceipt>): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

const AGENT_RUN_PERSISTENCE_WARNING =
    'Agent run recovery state could not be persisted after execution. The verified command receipt remains authoritative; do not retry automatically.';
const AGENT_RUN_STALE_COMPLETION_WARNING =
    'Agent work completed after its run lease was cancelled or replaced. The durable receipt was retained without reopening the terminal run.';

function tryRecordCommittedAgentRunWork(input: {
    runId: string;
    receipt: NonNullable<AgentApplyReceipt>;
    revertGroupId?: string;
    committedRevision?: string;
    completesRun?: boolean;
}): string | null {
    try {
        agentRunLifecycle.recordCommittedWork({
            runId: input.runId,
            workId: input.receipt.batchId,
            receiptIdentity: getAgentRunReceiptIdentity(input.receipt),
            ...(input.revertGroupId ? { revertGroupId: input.revertGroupId } : {}),
            renderJobIds: input.receipt.links.render.map((link) => link.jobId),
            analysisIds: input.receipt.links.analysis.map((link) => link.analysisId),
            ...(input.committedRevision ? { committedRevision: input.committedRevision } : {}),
            ...(input.completesRun !== undefined ? { completesRun: input.completesRun } : {}),
        });
        return null;
    } catch {
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

type AgentRunWorkLeaseSettlement = {
    accepted: boolean;
    warning: string | null;
};

function trySettleAgentRunWorkLease(
    lease: AgentRunWorkLease,
    terminalState: AgentRunWorkTerminalState
): AgentRunWorkLeaseSettlement {
    try {
        const settlement = agentRunWorkLease.settle({
            runId: lease.runId,
            workId: lease.workId,
            leaseId: lease.leaseId,
            cancellationGeneration: lease.cancellationGeneration,
            idempotencyKey: lease.idempotencyKey,
            receiptIdentity: lease.receiptIdentity,
            terminalState,
        });
        return {
            accepted: settlement.status === 'settled',
            warning: settlement.status === 'settled' ? null : AGENT_RUN_STALE_COMPLETION_WARNING,
        };
    } catch {
        return { accepted: true, warning: AGENT_RUN_PERSISTENCE_WARNING };
    }
}

function recordUnavailableProviderUsage(runId: string, backend: RunnableAiBackend): void {
    agentRunLifecycle.recordProviderUsage({
        runId,
        usage: {
            provider: backend,
            model: getBackendModelId(backend),
            inputTokens: null,
            outputTokens: null,
            provenance: 'unavailable',
        },
    });
}

export async function sendChatMessage(
    userText: string,
    options?: SendChatMessageOptions
): Promise<AgentApplyReceipt | undefined> {
    const backend = resolveBackend();
    const state = chatStore.value;
    if (!state || state.isGenerating) {
        return undefined;
    }
    const interactionMode = resolveAgentExecutionMode({ chatMode: state.chatMode, requestedMode: options?.mode });

    // Regular chat streams from one selected backend. Prompt mode delegates
    // readiness and provider fallback to generateToolCalls.
    if (backend === 'none') {
        throw createAiRuntimeError('No AI backend available. Configure an API key or use a WebGPU-capable browser.');
    }
    if (interactionMode === 'explain' && backend === 'native' && !isNativeEngineReady()) {
        throw createAiRuntimeError('Native AI engine is not running. Load the AI engine first.');
    }
    if (interactionMode === 'explain' && backend === 'webllm' && !getLlmEngine()) {
        throw createAiRuntimeError('AI Engine is not initialized or not supported on this device.');
    }
    if (interactionMode === 'explain' && backend === 'cloud' && !isCloudAvailable()) {
        throw createAiRuntimeError('Cloud AI not configured. Set API key in settings.');
    }

    const runId = `agent-run-${crypto.randomUUID()}`;
    agentRunLifecycle.create({
        runId,
        request: userText,
        mode: interactionMode,
        createdRevision: captureProjectRevision(),
    });
    agentRunLifecycle.transitionPhase({ runId, phase: 'planning' });
    const providerWorkId = interactionMode === 'explain' ? 'provider-response' : 'provider-planning';
    const providerReceiptIdentity = `provider:${backend}:${runId}`;
    const providerLeaseResult = agentRunWorkLease.claim({
        runId,
        workId: providerWorkId,
        ownerKind: 'provider',
        cleanupOwner: 'provider-adapter',
        idempotencyKey: providerReceiptIdentity,
        receiptIdentity: providerReceiptIdentity,
        idempotent: false,
        retriable: true,
    });
    if (providerLeaseResult.status !== 'claimed') {
        throw new Error(`Agent provider work could not be claimed: ${providerLeaseResult.status}`);
    }
    const providerLease = providerLeaseResult.lease;

    setChatGenerating(true);

    // ── Prompt Command Mode ──────────────────────────────────────────────
    if (interactionMode !== 'explain') {
        const aborter = new AbortController();
        let prompt_assistant_message_id: string | null = null;
        setActiveAborter(aborter);
        const releaseProviderCancellation = agentRunCancellation.bindAbortController({
            runId,
            lease: providerLease,
            controller: aborter,
            reason: 'User cancelled the run while provider planning was active.',
        });

        try {
            const { context, result, projectRevision } = await planPromptActions({
                prompt: userText,
                signal: aborter.signal,
            });
            agentRunWorkLease.settle({
                runId,
                workId: providerWorkId,
                leaseId: providerLease.leaseId,
                cancellationGeneration: providerLease.cancellationGeneration,
                idempotencyKey: providerLease.idempotencyKey,
                receiptIdentity: providerLease.receiptIdentity,
                terminalState: 'completed',
            });

            if (aborter.signal.aborted) {
                await agentRunCancellation.cancel({
                    runId,
                    reason: 'User cancelled the run before planning completed.',
                });
                return undefined;
            }

            if (result.actions.length > 0) {
                // Manually inject messages for Fast-Path execution
                const userMsgId = `msg-${crypto.randomUUID()}`;
                appendChatMessage({
                    id: userMsgId,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                    isCommandAction: true,
                });

                const assistantMsgId = `msg-${crypto.randomUUID()}`;
                prompt_assistant_message_id = assistantMsgId;
                appendChatMessage({
                    id: assistantMsgId,
                    role: 'assistant',
                    content: 'Executing...',
                    timestamp: Date.now(),
                    isCommandAction: true,
                });

                const confirmationDescription = describePendingActionConfirmation({
                    actions: result.actions,
                    context,
                    prompt: userText,
                    wholeProjectVibeMixPlan: result.wholeProjectVibeMixPlan,
                    workflowCapabilityId: result.workflowCapabilityId,
                });
                if (interactionMode === 'plan') {
                    agentRunLifecycle.recordPlan({
                        runId,
                        summary: confirmationDescription.actionLabels.join('\n'),
                        commandIds: [],
                        serializedBatchIdentity: null,
                        revision: projectRevision,
                        scope: {
                            targetIds: confirmationDescription.affectedIds,
                            targetRanges: [],
                            protectedTargetIds: confirmationDescription.protectedUnchanged.map((item) => item.id),
                            protectedRanges: [],
                        },
                        grants: {
                            allowedOperationPrefixes: [],
                            create: false,
                            delete: false,
                            routing: false,
                            tempo: false,
                            master: false,
                            file: false,
                            audioUpload: false,
                            remoteGeneration: false,
                            autoCommit: false,
                        },
                        budgets: { limits: {}, consumed: {} },
                    });
                    recordUnavailableProviderUsage(runId, backend);
                    agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
                    createStemImportConfirmationResourceLease(result.actions)?.release();
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: `Planned without changing the project:\n\n${confirmationDescription.actionLabels.map((label) => `- ${label}`).join('\n')}`,
                    });
                    return undefined;
                }
                const commandGroup = generateGroupId(userText);
                const compiledActionExecution = compileAgentActionExecution({
                    actions: result.actions,
                    actionLabels: confirmationDescription.actionLabels,
                    context,
                    group: commandGroup,
                    intent: userText,
                    projectRevision,
                    requiresConfirmation: result.requiresConfirmation,
                    runId,
                    mode: interactionMode,
                    protectedTargetIds: confirmationDescription.protectedUnchanged.map((item) => item.id),
                    trustCeiling: options?.trustCeiling,
                });
                const { commandEnvelopes, commandBatch } = compiledActionExecution;
                const parsedCommandBatch = parseVersionedCommandBatchEnvelope(
                    commandBatch.serialized,
                    commandBatch.authority
                );
                if (parsedCommandBatch.status === 'invalid') {
                    throw new Error(parsedCommandBatch.reason);
                }
                const commandIds = parsedCommandBatch.envelope.commands.map((command) => command.commandId);
                agentRunLifecycle.recordPlan({
                    runId,
                    summary: confirmationDescription.actionLabels.join('\n'),
                    commandIds,
                    serializedBatchIdentity: parsedCommandBatch.envelope.idempotencyKey,
                    revision: projectRevision,
                    scope: {
                        targetIds: [...commandBatch.authority.scope.targetIds],
                        targetRanges: commandBatch.authority.scope.targetRanges.map((range) => ({ ...range })),
                        protectedTargetIds: [...commandBatch.authority.scope.protectedTargetIds],
                        protectedRanges: commandBatch.authority.scope.protectedRanges.map((range) => ({ ...range })),
                    },
                    grants: {
                        allowedOperationPrefixes: [...commandBatch.authority.grants.allowedOperationPrefixes],
                        create: commandBatch.authority.grants.create,
                        delete: commandBatch.authority.grants.delete,
                        routing: commandBatch.authority.grants.routing,
                        tempo: commandBatch.authority.grants.tempo,
                        master: commandBatch.authority.grants.master,
                        file: commandBatch.authority.grants.file,
                        audioUpload: commandBatch.authority.grants.audioUpload,
                        remoteGeneration: commandBatch.authority.grants.remoteGeneration,
                        autoCommit: commandBatch.authority.grants.autoCommit,
                    },
                    budgets: {
                        limits: { ...commandBatch.authority.budgets },
                        consumed: { commands: commandIds.length },
                    },
                });
                agentRunLifecycle.recordBatch({
                    runId,
                    batch: {
                        batchId: parsedCommandBatch.envelope.batchId,
                        commandIds,
                        status: compiledActionExecution.requiresConfirmation ? 'waiting-for-approval' : 'planned',
                        receiptIdentity: null,
                    },
                });
                recordUnavailableProviderUsage(runId, backend);

                if (interactionMode === 'preview') {
                    const previewWorkId = `preview:${parsedCommandBatch.envelope.batchId}`;
                    const previewReceiptIdentity = `preview:${runId}:${parsedCommandBatch.envelope.batchId}`;
                    const previewLeaseResult = agentRunWorkLease.claim({
                        runId,
                        workId: previewWorkId,
                        ownerKind: 'command',
                        cleanupOwner: 'command-preview',
                        idempotencyKey: previewReceiptIdentity,
                        receiptIdentity: previewReceiptIdentity,
                        idempotent: true,
                        retriable: false,
                    });
                    if (previewLeaseResult.status !== 'claimed') {
                        throw new Error(`Agent preview work could not be claimed: ${previewLeaseResult.status}`);
                    }
                    agentRunLifecycle.transitionPhase({ runId, phase: 'previewing', revision: projectRevision });
                    const resourceLease = createStemImportConfirmationResourceLease(result.actions);
                    const releasePreviewCancellation = agentRunCancellation.bindAbortController({
                        runId,
                        lease: previewLeaseResult.lease,
                        controller: aborter,
                        reason: 'User cancelled the run while command preview was active.',
                    });
                    let preview: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
                    try {
                        preview = await executeVersionedCommandBatchEnvelope(commandBatch);
                        if (preview.status === 'cancelled') {
                            await agentRunCancellation.cancel({ runId, reason: preview.reason });
                        } else if (
                            (preview.status === 'rejected' ||
                                preview.status === 'conflicted' ||
                                preview.status === 'failed') &&
                            captureProjectRevision() !== projectRevision
                        ) {
                            await agentRunCancellation.cancel({ runId, reason: preview.reason });
                        }
                    } catch (error) {
                        trySettleAgentRunWorkLease(previewLeaseResult.lease, 'failed');
                        agentRunLifecycle.updateBatchStatus({
                            runId,
                            batchId: parsedCommandBatch.envelope.batchId,
                            status: 'failed',
                        });
                        throw error;
                    } finally {
                        releasePreviewCancellation();
                        resourceLease?.release();
                    }
                    if (preview.status === 'previewed') {
                        preview.resource.release();
                        const settlement = agentRunWorkLease.settle({
                            runId,
                            workId: previewWorkId,
                            leaseId: previewLeaseResult.lease.leaseId,
                            cancellationGeneration: previewLeaseResult.lease.cancellationGeneration,
                            idempotencyKey: previewLeaseResult.lease.idempotencyKey,
                            receiptIdentity: previewLeaseResult.lease.receiptIdentity,
                            terminalState: 'completed',
                        });
                        if (settlement.status !== 'settled') {
                            const currentRun = agentRunLifecycle.get(runId);
                            if (currentRun?.phase === 'cancelled' || currentRun?.phase === 'partially-completed') {
                                return undefined;
                            }
                            throw new Error(`Agent preview work could not be settled: ${settlement.status}`);
                        }
                        agentRunLifecycle.updateBatchStatus({
                            runId,
                            batchId: parsedCommandBatch.envelope.batchId,
                            status: 'previewed',
                        });
                        updateChatMessage(assistantMsgId, {
                            isStreaming: false,
                            content: `Previewed without changing the project:\n\n${confirmationDescription.actionLabels.map((label) => `- ${label}`).join('\n')}`,
                        });
                        agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
                        return undefined;
                    }
                    const previewSettlement = trySettleAgentRunWorkLease(
                        previewLeaseResult.lease,
                        preview.status === 'cancelled' ? 'cancelled' : 'failed'
                    );
                    if (!previewSettlement.accepted) {
                        const currentRun = agentRunLifecycle.get(runId);
                        if (currentRun?.phase === 'cancelled' || currentRun?.phase === 'partially-completed') {
                            return undefined;
                        }
                        throw new Error('Agent preview work could not be settled after a non-preview outcome');
                    }
                    agentRunLifecycle.updateBatchStatus({
                        runId,
                        batchId: parsedCommandBatch.envelope.batchId,
                        status: 'failed',
                    });
                    throw new Error('reason' in preview ? preview.reason : 'Command preview did not produce a preview');
                }

                if (compiledActionExecution.requiresConfirmation) {
                    const { agentApproval } = compiledActionExecution;
                    const confirmationId = `prompt-confirmation-${crypto.randomUUID()}`;
                    const confirmation = proposePendingActionConfirmation({
                        id: confirmationId,
                        runId,
                        prompt: userText,
                        assistantMessageId: assistantMsgId,
                        actions: result.actions,
                        actionLabels: confirmationDescription.actionLabels,
                        commandEnvelopes,
                        commandBatch,
                        agentApproval,
                        affectedIds: confirmationDescription.affectedIds,
                        protectedUnchanged: confirmationDescription.protectedUnchanged,
                        risk: {
                            level: agentApproval.policy.risk,
                            reason: agentApproval.policy.reasons.join(' ') || null,
                        },
                        executionMode: result.executionMode,
                        groupId: commandGroup.groupId,
                        groupLabel: commandGroup.groupLabel,
                        projectRevision,
                        resourceLease: createStemImportConfirmationResourceLease(result.actions),
                    });
                    if (!confirmation) {
                        const reason = 'Prepared action resources exceed the live confirmation limit.';
                        agentRunLifecycle.updateBatchStatus({
                            runId,
                            batchId: parsedCommandBatch.envelope.batchId,
                            status: 'failed',
                        });
                        agentRunLifecycle.recordError({
                            runId,
                            error: {
                                code: 'confirmation-not-retained',
                                message: reason,
                                occurredAt: Date.now(),
                                retriable: true,
                                workId: parsedCommandBatch.envelope.batchId,
                            },
                            terminal: true,
                        });
                        updateChatMessage(assistantMsgId, {
                            isStreaming: false,
                            pendingActionConfirmationStatus: 'failed',
                            error: reason,
                            content:
                                'This proposal was not retained because pending prepared resources reached their safe limit. Resolve or cancel an earlier proposal, then try again.',
                        });
                        return undefined;
                    }

                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        pendingActionConfirmationId: confirmationId,
                        pendingActionConfirmationStatus: 'proposed',
                        content: `${confirmationDescription.content}\n\n${describeAgentRiskApproval(agentApproval)}`,
                    });
                    agentRunLifecycle.transitionPhase({
                        runId,
                        phase: 'waiting-for-approval',
                        revision: projectRevision,
                    });
                    return undefined;
                }

                const executionInput = {
                    prompt: userText,
                    actions: result.actions,
                    group: commandGroup,
                    projectRevision,
                    executionMode: result.executionMode,
                    signal: aborter.signal,
                };
                agentRunLifecycle.transitionPhase({ runId, phase: 'executing', revision: projectRevision });
                const commandReceiptIdentity = `command:${runId}:${parsedCommandBatch.envelope.batchId}`;
                const commandLeaseResult = agentRunWorkLease.claim({
                    runId,
                    workId: parsedCommandBatch.envelope.batchId,
                    ownerKind: 'command',
                    cleanupOwner: 'command-executor',
                    idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
                    receiptIdentity: commandReceiptIdentity,
                    idempotent: true,
                    retriable: false,
                });
                if (commandLeaseResult.status !== 'claimed') {
                    throw new Error(`Agent command work could not be claimed: ${commandLeaseResult.status}`);
                }
                const releaseCommandCancellation = agentRunCancellation.bindAbortController({
                    runId,
                    lease: commandLeaseResult.lease,
                    controller: aborter,
                    reason: 'User cancelled the run while command execution was active.',
                });
                let execution: Awaited<ReturnType<typeof executePlannedActions>>;
                try {
                    execution = await executePlannedActions({ ...executionInput, commandBatch });
                    if (execution.status === 'invalidated' || execution.status === 'cancelled') {
                        await agentRunCancellation.cancel({
                            runId,
                            reason:
                                execution.status === 'invalidated'
                                    ? execution.reason
                                    : 'User cancelled before the command committed.',
                        });
                    }
                } catch (error) {
                    trySettleAgentRunWorkLease(commandLeaseResult.lease, 'failed');
                    throw error;
                } finally {
                    releaseCommandCancellation();
                }
                let commandLeaseTerminalState: 'completed' | 'cancelled' | 'failed' = 'failed';
                if (
                    execution.status === 'committed' ||
                    execution.status === 'executed' ||
                    execution.status === 'no-op'
                ) {
                    commandLeaseTerminalState = 'completed';
                } else if (execution.status === 'cancelled') {
                    commandLeaseTerminalState = 'cancelled';
                }
                const commandLeaseSettlement = trySettleAgentRunWorkLease(
                    commandLeaseResult.lease,
                    commandLeaseTerminalState
                );
                const commandLeasePersistenceWarning = commandLeaseSettlement.warning;

                if (execution.status === 'committed') {
                    if (!execution.receipt) {
                        throw new Error('Applied command did not return a verified receipt');
                    }
                    const receiptWarnings: string[] = [];
                    if (execution.commitWarning) {
                        receiptWarnings.push(`Post-commit project follow-up warning: ${execution.commitWarning}`);
                    }
                    if (execution.reportingWarning) {
                        receiptWarnings.push(
                            `AI history or notification reporting warning: ${execution.reportingWarning}`
                        );
                    }
                    const runPersistenceWarning = tryRecordCommittedAgentRunWork({
                        runId,
                        receipt: execution.receipt,
                        revertGroupId: commandGroup.groupId,
                        committedRevision: captureProjectRevision(),
                        completesRun: commandLeaseSettlement.accepted,
                    });
                    if (runPersistenceWarning) {
                        receiptWarnings.push(runPersistenceWarning);
                    }
                    if (commandLeasePersistenceWarning && !runPersistenceWarning) {
                        receiptWarnings.push(commandLeasePersistenceWarning);
                    }
                    const actionSummary = execution.actions
                        .map((entry) => `- **${entry.actionType.replaceAll('_', ' ')}**: ${entry.label}`)
                        .join('\n');
                    const warningSummary = receiptWarnings.join(' ');
                    const content = warningSummary
                        ? `Applied:\n\n${actionSummary}\n\n${warningSummary} The project change committed. Do not retry automatically; inspect the current project state.`
                        : `Executed:\n\n${actionSummary}`;
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: warningSummary || undefined,
                        content,
                    });
                    return execution.receipt;
                }

                if (execution.status === 'executed') {
                    if (!execution.receipt) {
                        throw new Error('Executed command did not return a verified receipt');
                    }
                    const receiptWarnings: string[] = [];
                    if (execution.executionWarning) {
                        receiptWarnings.push(`Runtime follow-up warning: ${execution.executionWarning}`);
                    }
                    if (execution.reportingWarning) {
                        receiptWarnings.push(
                            `AI history or notification reporting warning: ${execution.reportingWarning}`
                        );
                    }
                    const runPersistenceWarning = tryRecordCommittedAgentRunWork({
                        runId,
                        receipt: execution.receipt,
                        completesRun: commandLeaseSettlement.accepted,
                    });
                    if (runPersistenceWarning) {
                        receiptWarnings.push(runPersistenceWarning);
                    }
                    if (commandLeasePersistenceWarning && !runPersistenceWarning) {
                        receiptWarnings.push(commandLeasePersistenceWarning);
                    }
                    const actionSummary = execution.actions
                        .map((entry) => `- **${entry.actionType.replaceAll('_', ' ')}**: ${entry.label}`)
                        .join('\n');
                    const warningSummary = receiptWarnings.join(' ');
                    let content = `Executed:\n\n${actionSummary}`;
                    if (warningSummary) {
                        content = `${content}\n\n${warningSummary} The runtime command executed. Do not retry automatically; inspect the current runtime state.`;
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: warningSummary || undefined,
                        content,
                    });
                    return execution.receipt;
                }

                if (execution.status === 'invalidated') {
                    if (commandLeaseSettlement.accepted) {
                        await agentRunCancellation.cancel({
                            runId,
                            reason: execution.reason,
                        });
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: execution.reason,
                        content:
                            'The project changed before this command could commit. Review it and submit the command again.',
                    });
                    return undefined;
                }

                if (execution.status === 'cancelled') {
                    if (commandLeaseSettlement.accepted) {
                        await agentRunCancellation.cancel({
                            runId,
                            reason: 'User cancelled before the command committed.',
                        });
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: 'Command cancelled before it committed. No project changes were applied.',
                    });
                    return undefined;
                }

                if (execution.status === 'no-op') {
                    if (commandLeaseSettlement.accepted) {
                        agentRunLifecycle.updateBatchStatus({
                            runId,
                            batchId: parsedCommandBatch.envelope.batchId,
                            status: 'no-op',
                        });
                        agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        content: 'No project changes were needed.',
                    });
                    return undefined;
                }

                if (execution.status === 'ambiguous') {
                    if (commandLeaseSettlement.accepted) {
                        agentRunLifecycle.recordError({
                            runId,
                            error: {
                                code: 'ambiguous-command-outcome',
                                message: execution.reason,
                                occurredAt: Date.now(),
                                retriable: false,
                                workId: parsedCommandBatch.envelope.batchId,
                            },
                            terminal: true,
                        });
                    }
                    updateChatMessage(assistantMsgId, {
                        isStreaming: false,
                        error: execution.reason,
                        content: `The command stopped after an uncertain partial commit: ${execution.reason}. Do not retry it; inspect the project first.`,
                    });
                    return undefined;
                }

                updateChatMessage(assistantMsgId, {
                    isStreaming: false,
                    error: execution.reason,
                    content: `Failed to execute prompt command atomically: ${execution.reason}`,
                });
                if (commandLeaseSettlement.accepted) {
                    agentRunLifecycle.recordError({
                        runId,
                        error: {
                            code: 'command-execution-failed',
                            message: execution.reason,
                            occurredAt: Date.now(),
                            retriable: false,
                            workId: parsedCommandBatch.envelope.batchId,
                        },
                        terminal: true,
                    });
                }
            } else if (result.rejectionReason) {
                recordUnavailableProviderUsage(runId, backend);
                agentRunLifecycle.recordError({
                    runId,
                    error: {
                        code: 'planning-rejected',
                        message: result.rejectionReason,
                        occurredAt: Date.now(),
                        retriable: false,
                        workId: null,
                    },
                    terminal: true,
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: `Command not executed: ${result.rejectionReason}`,
                    timestamp: Date.now(),
                    error: result.rejectionReason,
                });
            } else {
                recordUnavailableProviderUsage(runId, backend);
                agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                    isCommandAction: true,
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: 'No actions were matched or executed for your command.',
                    timestamp: Date.now(),
                    error: 'No actions matched',
                });
            }
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            const configurationChanged = isAiRuntimeConfigurationChangedError(error);
            const proposalInvalidated = error instanceof AiProposalInvalidatedError;
            if (aborter.signal.aborted || configurationChanged || proposalInvalidated) {
                await agentRunCancellation.cancel({ runId, reason });
            } else {
                trySettleAgentRunWorkLease(providerLease, 'failed');
                agentRunLifecycle.recordError({
                    runId,
                    error: {
                        code: 'prompt-run-failed',
                        message: reason,
                        occurredAt: Date.now(),
                        retriable: false,
                        workId: null,
                    },
                    terminal: true,
                });
            }
            let failureContent = 'Failed to process prompt command.';
            if (configurationChanged) {
                failureContent = 'Prompt cancelled because the AI configuration changed.';
            } else if (proposalInvalidated) {
                failureContent =
                    'The project changed while this command was being planned. Review the current project and submit it again.';
            }
            if (prompt_assistant_message_id) {
                updateChatMessage(prompt_assistant_message_id, {
                    isStreaming: false,
                    content: configurationChanged
                        ? 'Prompt cancelled because the AI configuration changed.'
                        : 'Failed to execute prompt command.',
                    error: reason,
                });
            } else {
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'user',
                    content: userText,
                    timestamp: Date.now(),
                });
                appendChatMessage({
                    id: `msg-${crypto.randomUUID()}`,
                    role: 'assistant',
                    content: failureContent,
                    error: reason,
                    timestamp: Date.now(),
                });
            }
        } finally {
            releaseProviderCancellation();
            setActiveAborter(null);
            setChatGenerating(false);
        }
        return undefined;
    }

    // ── Regular Chat Mode ───────────────────────────────────────────────
    const userMsgId = `msg-${crypto.randomUUID()}`;
    appendChatMessage({
        id: userMsgId,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
    });

    const assistantMsgId = `msg-${crypto.randomUUID()}`;
    const initialAssistantMessage: ChatMessage = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
    };
    appendChatMessage(initialAssistantMessage);

    const aborter = new AbortController();
    setActiveAborter(aborter);
    const releaseProviderCancellation = agentRunCancellation.bindAbortController({
        runId,
        lease: providerLease,
        controller: aborter,
        reason: 'User cancelled the run while the provider response was active.',
    });
    const previousLlmStatus = llmStatusStore.value;
    llmStatusStore.set({ state: 'generating' });
    // Incremental think-block parser: feeding each streamed token keeps the
    // boundary scan linear instead of re-scanning the whole buffer per token.
    // It also retains the full accumulated text internally, so no separate
    // buffer is needed.
    const thinkParser = createThinkBlockParser();
    let cloudOutcome: CloudChatCompletionOutcome | null = null;
    let webLlmIncompleteReason: string | null = null;

    try {
        const workspaceContext = getProjectContext();

        const systemPrompt = `${CHAT_SYSTEM_PROMPT}\n\nCURRENT DAW CONTEXT:\n${JSON.stringify(workspaceContext)}`;

        // Keep only the last 24 messages (12 user+assistant pairs) to avoid
        // blowing the context window on long conversations.
        const conversationHistory = chatStore
            .value!.messages.filter((message) => message.id !== assistantMsgId && !message.error)
            .slice(-24)
            .map((message) => ({
                role: message.role,
                content: message.content,
            }));

        const completionMessages: Array<{
            role: 'system' | 'user' | 'assistant';
            content: string;
        }> = [{ role: 'system', content: systemPrompt }, ...conversationHistory];

        if (backend === 'native') {
            // Native: streaming completion via Tauri Channel API
            await streamNativeCompletion(
                completionMessages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    const parsed = thinkParser.push(token);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                // Thread the abort signal so Stop tears the stream down at the
                // source: in browser dev mode the SSE loop breaks immediately
                // instead of draining the whole response, and in native mode the
                // watchdog race is unblocked. Without this, only the per-token
                // throw above could stop it — and only while tokens keep arriving.
                { temperature: 0.7, maxTokens: 2048, signal: aborter.signal }
            );
        } else if (backend === 'cloud') {
            // Cloud: streaming completion via Claude API
            cloudOutcome = await streamCloudChatCompletion(
                completionMessages,
                (token) => {
                    if (aborter.signal.aborted) {
                        throw createAiRuntimeError('AbortedByUser');
                    }
                    const parsed = thinkParser.push(token);
                    updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                },
                { temperature: 0.7, maxTokens: 2048, signal: aborter.signal }
            );
        } else {
            // WebLLM: streaming completion via the in-browser engine.
            // Yield to the render loop before starting inference — the first
            // forward pass triggers WebGPU shader compilation which locks the
            // GPU (shared with the compositor). Without this yield, the browser
            // can't paint the "Thinking..." state before the GPU gets busy.
            await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
            aborter.signal.throwIfAborted();

            const engine = getLlmEngine()!;
            function interruptWebLlm(): void {
                engine.interruptGenerate();
            }
            aborter.signal.addEventListener('abort', interruptWebLlm, { once: true });

            try {
                const asyncChunkGenerator = (await engine.chat.completions.create({
                    messages: completionMessages,
                    temperature: 0.7,
                    max_tokens: 2048,
                    stream: true,
                })) as AsyncIterable<{
                    choices: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
                }>;
                let sawTerminalReason = false;

                for await (const chunk of asyncChunkGenerator) {
                    if (aborter.signal.aborted) {
                        break;
                    }
                    const choice = chunk.choices[0];
                    const deltaDesc = choice?.delta.content;
                    if (deltaDesc !== undefined) {
                        const parsed = thinkParser.push(deltaDesc);
                        updateChatMessage(assistantMsgId, { content: parsed.content, reasoning: parsed.reasoning });
                    }
                    if (choice?.finish_reason !== undefined && choice.finish_reason !== null) {
                        sawTerminalReason = true;
                        if (choice.finish_reason !== 'stop') {
                            webLlmIncompleteReason = choice.finish_reason;
                        }
                    }
                }
                if (!aborter.signal.aborted && !sawTerminalReason) {
                    throw new Error('WebLLM chat stream ended unexpectedly');
                }
            } finally {
                aborter.signal.removeEventListener('abort', interruptWebLlm);
            }
        }

        if (aborter.signal.aborted) {
            throw aborter.signal.reason;
        }

        // Strip <think>…</think> reasoning block before storing the final message.
        const { reasoning, content: cleanContent } = thinkParser.snapshot();
        const incompleteReason = cloudOutcome?.status === 'incomplete' ? cloudOutcome.reason : webLlmIncompleteReason;
        const incompleteNotice =
            incompleteReason === null ? '' : `\n\n_Response incomplete: provider stopped at ${incompleteReason}._`;
        let incompleteError: string | undefined;
        if (cloudOutcome?.status === 'incomplete') {
            incompleteError = `Hosted AI response incomplete (${cloudOutcome.reason})`;
        } else if (webLlmIncompleteReason !== null) {
            incompleteError = `WebLLM response incomplete (${webLlmIncompleteReason})`;
        }
        updateChatMessage(assistantMsgId, {
            isStreaming: false,
            content: `${cleanContent}${incompleteNotice}`,
            reasoning,
            error: incompleteError,
        });
        agentRunWorkLease.settle({
            runId,
            workId: providerWorkId,
            leaseId: providerLease.leaseId,
            cancellationGeneration: providerLease.cancellationGeneration,
            idempotencyKey: providerLease.idempotencyKey,
            receiptIdentity: providerLease.receiptIdentity,
            terminalState: 'completed',
        });
        recordUnavailableProviderUsage(runId, backend);
        agentRunLifecycle.transitionPhase({ runId, phase: 'completed' });
        llmStatusStore.set({ state: 'ready', backend, modelId: getBackendModelId(backend) });
    } catch (error) {
        const errorMessage = (() => {
            if (isAppError(error)) {
                return error.message;
            }
            if (error instanceof Error) {
                return error.message;
            }
            return 'An unknown error occurred during generation.';
        })();
        if (isAiRuntimeConfigurationChangedError(error)) {
            trySettleAgentRunWorkLease(providerLease, 'cancelled');
            await agentRunCancellation.cancel({ runId, reason: errorMessage });
            const parsed = thinkParser.snapshot();
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
                error: 'Hosted AI configuration changed; this response was cancelled.',
            });
            llmStatusStore.set({ state: 'idle' });
            return undefined;
        }

        const wasAborted =
            aborter.signal.aborted ||
            (error instanceof Error && error.name === 'AbortError') ||
            errorMessage === 'AbortedByUser' ||
            errorMessage.includes('AbortError');
        if (!wasAborted) {
            agentRunWorkLease.settle({
                runId,
                workId: providerWorkId,
                leaseId: providerLease.leaseId,
                cancellationGeneration: providerLease.cancellationGeneration,
                idempotencyKey: providerLease.idempotencyKey,
                receiptIdentity: providerLease.receiptIdentity,
                terminalState: 'failed',
            });
        }
        if (wasAborted) {
            await agentRunCancellation.cancel({ runId, reason: errorMessage });
            // Clean abort, leave generated partial content intact and strip parsing blocks
            const parsed = thinkParser.snapshot();
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                content: parsed.content,
                reasoning: parsed.reasoning,
            });
            const currentPreference = aiBackendPreferenceStore.value ?? 'auto';
            if (currentPreference !== 'auto' && currentPreference !== backend) {
                llmStatusStore.set({ state: 'idle' });
            } else if (
                previousLlmStatus?.state === 'ready' &&
                previousLlmStatus.backend === 'cloud' &&
                !isCloudAvailable()
            ) {
                llmStatusStore.set({ state: 'idle' });
            } else {
                llmStatusStore.set(previousLlmStatus ?? { state: 'idle' });
            }
        } else {
            agentRunLifecycle.recordError({
                runId,
                error: {
                    code: 'provider-stream-failed',
                    message: errorMessage,
                    occurredAt: Date.now(),
                    retriable: true,
                    workId: null,
                },
                terminal: true,
            });
            const parsed = thinkParser.snapshot();
            const hasPartialContent = parsed.content.length > 0 || (parsed.reasoning?.length ?? 0) > 0;
            updateChatMessage(assistantMsgId, {
                isStreaming: false,
                error: errorMessage,
                content: hasPartialContent
                    ? `${parsed.content}\n\n_Response incomplete because the provider stream failed._`
                    : 'Sorry, I encountered an error while thinking about that.',
                reasoning: parsed.reasoning,
            });
            llmStatusStore.set({ state: 'error', message: errorMessage });
        }
    } finally {
        releaseProviderCancellation();
        setActiveAborter(null);
        setChatGenerating(false);
    }
    return undefined;
}
