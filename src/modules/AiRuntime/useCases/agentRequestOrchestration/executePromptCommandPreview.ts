import { logger } from '#/infra/logger/appLogger';
import { executeVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type ExecutableRuntimeAction } from '../../models/ExecutableRuntimeAction';
import { updateChatMessage } from '../../stores/chatStore';
import { createStemImportConfirmationResourceLease } from '../agentReference/createStemImportConfirmationResourceLease';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { agentRunCancellation } from '../cancelAgentRun';

import { settleAgentRunWorkLeaseSafely } from './settleAgentRunWorkLeaseSafely';

import type { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

type ParsedCommandBatch = Extract<ReturnType<typeof parseVersionedCommandBatchEnvelope>, { status: 'valid' }>;

type ExecutePromptCommandPreviewInput = {
    runId: string;
    assistantMessageId: string;
    actions: readonly ExecutableRuntimeAction[];
    actionLabels: readonly string[];
    abortController: AbortController;
    projectRevision: string;
    commandBatch: Parameters<typeof executeVersionedCommandBatchEnvelope>[0];
    parsedCommandBatch: ParsedCommandBatch;
    onExecutionSettlementWarning: (warning: string | null) => void;
};

function appendSettlementWarning(content: string, warning: string | null): string {
    return warning ? `${content}\n\n_${warning}_` : content;
}

export async function executePromptCommandPreview(input: ExecutePromptCommandPreviewInput): Promise<void> {
    agentRunLifecycle.transitionPhase({
        runId: input.runId,
        phase: 'previewing',
        revision: input.projectRevision,
    });
    const previewWorkId = `preview:${input.parsedCommandBatch.envelope.batchId}`;
    const previewReceiptIdentity = `preview:${input.runId}:${input.parsedCommandBatch.envelope.batchId}`;
    const previewLeaseResult = agentRunWorkLease.claim({
        runId: input.runId,
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
    const resourceLease = createStemImportConfirmationResourceLease(input.runId, input.actions);
    const releasePreviewCancellation = agentRunCancellation.bindAbortController({
        runId: input.runId,
        lease: previewLeaseResult.lease,
        controller: input.abortController,
        reason: 'User cancelled the run while command preview was active.',
    });
    let preview: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
    try {
        preview = await executeVersionedCommandBatchEnvelope(input.commandBatch);
        if (preview.status === 'cancelled') {
            await agentRunCancellation.cancel({ runId: input.runId, reason: preview.reason });
        } else if (
            (preview.status === 'rejected' || preview.status === 'conflicted' || preview.status === 'failed') &&
            captureProjectRevision() !== input.projectRevision
        ) {
            await agentRunCancellation.cancel({ runId: input.runId, reason: preview.reason });
        }
    } catch (error) {
        const settlement = settleAgentRunWorkLeaseSafely({
            lease: previewLeaseResult.lease,
            terminalState: 'failed',
            evidence: 'none',
            settle: agentRunWorkLease.settle,
            reportFailure: (settlementError) =>
                logger.error(
                    new Error('Failed preview work lease settlement failed', {
                        cause: settlementError,
                    })
                ),
        });
        input.onExecutionSettlementWarning(settlement.warning);
        agentRunLifecycle.updateBatchStatus({
            runId: input.runId,
            batchId: input.parsedCommandBatch.envelope.batchId,
            status: 'failed',
        });
        throw error;
    } finally {
        releasePreviewCancellation();
        await resourceLease?.releaseBestEffort();
    }
    if (preview.status === 'previewed') {
        preview.resource.release();
        const settlement = settleAgentRunWorkLeaseSafely({
            lease: previewLeaseResult.lease,
            terminalState: 'completed',
            evidence: 'visible-work-output',
            settle: agentRunWorkLease.settle,
            reportFailure: (settlementError) =>
                logger.error(new Error('Preview work lease settlement failed', { cause: settlementError })),
        });
        if (!settlement.accepted) {
            const currentRun = agentRunLifecycle.get(input.runId);
            if (currentRun?.phase === 'cancelled' || currentRun?.phase === 'partially-completed') {
                return;
            }
            throw new Error('Agent preview work could not be settled');
        }
        updateChatMessage(input.assistantMessageId, {
            isStreaming: false,
            error: settlement.warning ?? undefined,
            content: appendSettlementWarning(
                `Previewed without changing the project:\n\n${input.actionLabels.map((label) => `- ${label}`).join('\n')}`,
                settlement.warning
            ),
        });
        try {
            agentRunLifecycle.updateBatchStatus({
                runId: input.runId,
                batchId: input.parsedCommandBatch.envelope.batchId,
                status: 'previewed',
            });
        } catch (batchPersistenceError) {
            logger.error(new Error('Preview batch persistence failed', { cause: batchPersistenceError }));
        }
        if (settlement.warning === null) {
            try {
                agentRunLifecycle.transitionPhase({ runId: input.runId, phase: 'completed' });
            } catch (lifecyclePersistenceError) {
                logger.error(
                    new Error('Preview lifecycle persistence failed', {
                        cause: lifecyclePersistenceError,
                    })
                );
            }
        }
        return;
    }
    const previewSettlement = settleAgentRunWorkLeaseSafely({
        lease: previewLeaseResult.lease,
        terminalState: preview.status === 'cancelled' ? 'cancelled' : 'failed',
        evidence: 'none',
        settle: agentRunWorkLease.settle,
    });
    if (!previewSettlement.accepted) {
        const currentRun = agentRunLifecycle.get(input.runId);
        if (currentRun?.phase === 'cancelled' || currentRun?.phase === 'partially-completed') {
            return;
        }
        throw new Error('Agent preview work could not be settled after a non-preview outcome');
    }
    agentRunLifecycle.updateBatchStatus({
        runId: input.runId,
        batchId: input.parsedCommandBatch.envelope.batchId,
        status: 'failed',
    });
    throw new Error('reason' in preview ? preview.reason : 'Command preview did not produce a preview');
}
