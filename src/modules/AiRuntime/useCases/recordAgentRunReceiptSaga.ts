import { type createVerifiedBatchReceipt } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { agentRunLifecycle } from './agentRunLifecycle';
import { createAgentSagaStep } from './createAgentSagaStep';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;

function getAgentRunReceiptIdentity(receipt: VerifiedBatchReceipt): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

/** The sole AgentRun receipt writer for both direct and confirmed command execution. */
export function recordAgentRunReceiptSaga(input: {
    runId: string;
    receipt: VerifiedBatchReceipt;
    actions: readonly AppAction[];
    revertGroupId?: string;
    committedRevision?: string;
    completesRun?: boolean;
}): { effectsPending: boolean } {
    const receiptIdentity = getAgentRunReceiptIdentity(input.receipt);
    const recordedAt = Date.now();
    const pendingRuntimeEffects = input.receipt.pendingEffects.filter(({ kind }) => kind === 'runtime-graph');
    const pendingRuntimeEffectStepIds = new Set(
        pendingRuntimeEffects.map(({ commandId }) => `runtime-effect:${input.receipt.batchId}:${commandId}`)
    );
    const completesRun = pendingRuntimeEffects.length > 0 ? false : input.completesRun;
    for (const step of agentRunLifecycle.get(input.runId)?.saga.steps ?? []) {
        if (
            step.owner === 'external-effect' &&
            step.workId === input.receipt.batchId &&
            step.stepId.startsWith(`runtime-effect:${input.receipt.batchId}:`) &&
            !pendingRuntimeEffectStepIds.has(step.stepId)
        ) {
            agentRunLifecycle.recordSagaStep({
                runId: input.runId,
                step: {
                    ...step,
                    receiptIdentity,
                    state: 'committed',
                    updatedAt: recordedAt,
                },
            });
        }
    }
    agentRunLifecycle.recordCommittedWork({
        runId: input.runId,
        workId: input.receipt.batchId,
        receiptIdentity,
        ...(input.revertGroupId ? { revertGroupId: input.revertGroupId } : {}),
        ...(input.committedRevision ? { committedRevision: input.committedRevision } : {}),
        ...(completesRun !== undefined ? { completesRun } : {}),
        renderJobIds: input.receipt.links.render.map((link) => link.jobId),
        analysisIds: input.receipt.links.analysis.map((link) => link.analysisId),
    });
    agentRunLifecycle.recordSagaStep({
        runId: input.runId,
        step: createAgentSagaStep({
            stepId: `command:${input.receipt.batchId}`,
            order: 0,
            owner: 'command',
            workId: input.receipt.batchId,
            receiptIdentity,
            state: 'committed',
            relatedArtifactIds: [],
            updatedAt: recordedAt,
            compensationAvailable: input.revertGroupId !== undefined,
        }),
    });
    for (const [index, link] of input.receipt.links.render.entries()) {
        agentRunLifecycle.recordSagaStep({
            runId: input.runId,
            step: createAgentSagaStep({
                stepId: `render:${link.jobId}`,
                order: index + 1,
                owner: 'render',
                workId: link.jobId,
                receiptIdentity,
                state: 'committed',
                relatedArtifactIds: [link.jobId],
                updatedAt: recordedAt,
                compensationAvailable: false,
            }),
        });
    }
    for (const [index, link] of input.receipt.links.analysis.entries()) {
        agentRunLifecycle.recordSagaStep({
            runId: input.runId,
            step: createAgentSagaStep({
                stepId: `analysis:${link.analysisId}`,
                order: input.receipt.links.render.length + index + 1,
                owner: 'analysis',
                workId: link.analysisId,
                receiptIdentity,
                state: 'committed',
                relatedArtifactIds: [link.analysisId],
                updatedAt: recordedAt,
                compensationAvailable: false,
            }),
        });
    }
    const uncompensatedRenderJobIds =
        input.receipt.outcome === 'partially-committed'
            ? input.actions
                  .flatMap((action) => (action.type === 'renderProjectSections' ? (action.payload.jobs ?? []) : []))
                  .map((job) => job.jobId)
                  .filter((jobId) => !input.receipt.links.render.some((link) => link.jobId === jobId))
            : [];
    if (uncompensatedRenderJobIds.length > 0) {
        for (const [index, jobId] of uncompensatedRenderJobIds.entries()) {
            agentRunLifecycle.recordSagaStep({
                runId: input.runId,
                step: createAgentSagaStep({
                    stepId: `render:${jobId}`,
                    order: input.receipt.links.render.length + input.receipt.links.analysis.length + index + 1,
                    owner: 'render',
                    workId: jobId,
                    receiptIdentity,
                    state: 'uncompensated',
                    relatedArtifactIds: [jobId],
                    updatedAt: recordedAt,
                    compensationAvailable: false,
                }),
            });
        }
    }
    const importedStems = input.actions.flatMap((action) =>
        action.type === 'importStemSet' ? action.payload.stems : []
    );
    if (importedStems.length > 0) {
        agentRunLifecycle.recordSagaStep({
            runId: input.runId,
            step: createAgentSagaStep({
                stepId: `import:${input.receipt.batchId}`,
                order:
                    input.receipt.links.render.length +
                    input.receipt.links.analysis.length +
                    uncompensatedRenderJobIds.length +
                    1,
                owner: 'import',
                workId: input.receipt.batchId,
                receiptIdentity,
                state: 'committed',
                relatedArtifactIds: importedStems.map((stem) => stem.stemId),
                updatedAt: recordedAt,
                compensationAvailable: false,
            }),
        });
    }
    for (const [index, effect] of pendingRuntimeEffects.entries()) {
        agentRunLifecycle.recordSagaStep({
            runId: input.runId,
            step: createAgentSagaStep({
                stepId: `runtime-effect:${input.receipt.batchId}:${effect.commandId}`,
                order:
                    input.receipt.links.render.length +
                    input.receipt.links.analysis.length +
                    uncompensatedRenderJobIds.length +
                    (importedStems.length > 0 ? 1 : 0) +
                    index +
                    1,
                owner: 'external-effect',
                workId: input.receipt.batchId,
                receiptIdentity,
                state: 'external-pending',
                relatedArtifactIds: [],
                updatedAt: recordedAt,
                compensationAvailable: false,
            }),
        });
    }
    return { effectsPending: input.receipt.outcome === 'partially-committed' };
}
