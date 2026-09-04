import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import {
    type AgentRunPendingEffect,
    type AgentRunPendingEffectContinuation,
    type AgentRunSagaStep,
} from '../models/AgentRun';

import { createAgentRunPendingEffectContinuation } from './createAgentRunPendingEffectContinuation';
import { createAgentSagaStep } from './createAgentSagaStep';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type CommandBatch = Pick<ReturnType<typeof compileVersionedCommandBatchEnvelope>, 'authority' | 'serialized'>;

export type AgentRunReceiptSagaInput = {
    runId: string;
    receipt: VerifiedBatchReceipt;
    actions: readonly AppAction[];
    revertGroupId?: string;
    committedRevision?: string;
    completesRun?: boolean;
    commandBatch?: CommandBatch;
};

export type AgentRunReceiptSagaProjection = {
    receiptIdentity: string;
    recordedAt: number;
    work: {
        workId: string;
        receiptIdentity: string;
        revertGroupId: string | null;
        committedRevision?: string;
        completesRun?: boolean;
        renderJobIds: string[];
        analysisIds: string[];
    };
    sagaSteps: AgentRunSagaStep[];
    pendingEffectContinuation: AgentRunPendingEffectContinuation | null;
    completesPendingEffectContinuation: boolean;
    effectsPending: boolean;
};

// The store admits `sourceRevision` only on continuations whose every effect is a
// render-project-sections external effect; anything else keeps its honest generic recovery.
function hasOnlyRenderProjectSectionsEffects(effects: readonly AgentRunPendingEffect[]): boolean {
    return effects.every((effect) => effect.kind === 'external-effect' && effect.operation === 'renderProjectSections');
}

/** Pure receipt projection shared by ordinary and recovery-fallback lifecycle writers. */
export function projectAgentRunReceiptSaga(
    input: AgentRunReceiptSagaInput & {
        existingSagaSteps: readonly AgentRunSagaStep[];
        hasPendingEffectRecovery: boolean;
        recordedAt?: number;
    }
): AgentRunReceiptSagaProjection {
    const receiptIdentity = `${input.receipt.schemaVersion}:${input.receipt.runId}:${input.receipt.batchId}:${input.receipt.outcome}`;
    const recordedAt = input.recordedAt ?? Date.now();
    const pendingEffects = input.receipt.pendingEffects;
    const pendingEffectCommandIds = new Set(pendingEffects.map(({ commandId }) => commandId));
    const pendingEffectStepIds = new Set(
        pendingEffects.map(({ commandId }) => `effect:${input.receipt.batchId}:${commandId}`)
    );
    const completesRun = pendingEffects.length > 0 ? false : input.completesRun;
    const staleExternalEffectSteps = input.existingSagaSteps.filter(
        (step) =>
            step.owner === 'external-effect' &&
            step.workId === input.receipt.batchId &&
            !pendingEffectStepIds.has(step.stepId) &&
            ![...pendingEffectCommandIds].some((commandId) => step.stepId.endsWith(`:${commandId}`))
    );
    const sagaSteps: AgentRunSagaStep[] = staleExternalEffectSteps.map((step) => ({
        ...step,
        receiptIdentity,
        state: 'committed',
        updatedAt: recordedAt,
    }));
    sagaSteps.push(
        createAgentSagaStep({
            stepId: `command:${input.receipt.batchId}`,
            order: 0,
            owner: 'command',
            workId: input.receipt.batchId,
            receiptIdentity,
            state: 'committed',
            relatedArtifactIds: [],
            updatedAt: recordedAt,
            compensationAvailable: input.revertGroupId !== undefined,
        })
    );
    for (const [index, link] of input.receipt.links.render.entries()) {
        sagaSteps.push(
            createAgentSagaStep({
                stepId: `render:${link.jobId}`,
                order: index + 1,
                owner: 'render',
                workId: link.jobId,
                receiptIdentity,
                state: 'committed',
                relatedArtifactIds: [link.jobId],
                updatedAt: recordedAt,
                compensationAvailable: false,
            })
        );
    }
    for (const [index, link] of input.receipt.links.analysis.entries()) {
        sagaSteps.push(
            createAgentSagaStep({
                stepId: `analysis:${link.analysisId}`,
                order: input.receipt.links.render.length + index + 1,
                owner: 'analysis',
                workId: link.analysisId,
                receiptIdentity,
                state: 'committed',
                relatedArtifactIds: [link.analysisId],
                updatedAt: recordedAt,
                compensationAvailable: false,
            })
        );
    }
    const uncompensatedRenderJobIds =
        input.receipt.outcome === 'partially-committed'
            ? input.actions
                  .flatMap((action) => (action.type === 'renderProjectSections' ? (action.payload.jobs ?? []) : []))
                  .map((job) => job.jobId)
                  .filter((jobId) => !input.receipt.links.render.some((link) => link.jobId === jobId))
            : [];
    for (const [index, jobId] of uncompensatedRenderJobIds.entries()) {
        sagaSteps.push(
            createAgentSagaStep({
                stepId: `render:${jobId}`,
                order: input.receipt.links.render.length + input.receipt.links.analysis.length + index + 1,
                owner: 'render',
                workId: jobId,
                receiptIdentity,
                state: 'uncompensated',
                relatedArtifactIds: [jobId],
                updatedAt: recordedAt,
                compensationAvailable: false,
            })
        );
    }
    const importedStems = input.actions.flatMap((action) =>
        action.type === 'importStemSet' ? action.payload.stems : []
    );
    if (importedStems.length > 0) {
        sagaSteps.push(
            createAgentSagaStep({
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
            })
        );
    }
    for (const [index, effect] of pendingEffects.entries()) {
        sagaSteps.push(
            createAgentSagaStep({
                stepId: `effect:${input.receipt.batchId}:${effect.commandId}`,
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
            })
        );
    }
    const sourceRevision =
        input.committedRevision !== undefined && hasOnlyRenderProjectSectionsEffects(pendingEffects)
            ? input.committedRevision
            : undefined;
    const pendingEffectContinuation =
        pendingEffects.length > 0 && input.commandBatch
            ? createAgentRunPendingEffectContinuation({
                  receipt: input.receipt,
                  commandBatch: input.commandBatch,
                  ...(sourceRevision === undefined ? {} : { sourceRevision }),
              })
            : null;
    return {
        receiptIdentity,
        recordedAt,
        work: {
            workId: input.receipt.batchId,
            receiptIdentity,
            revertGroupId: input.revertGroupId ?? null,
            ...(input.committedRevision ? { committedRevision: input.committedRevision } : {}),
            ...(completesRun !== undefined ? { completesRun } : {}),
            renderJobIds: input.receipt.links.render.map((link) => link.jobId),
            analysisIds: input.receipt.links.analysis.map((link) => link.analysisId),
        },
        sagaSteps,
        pendingEffectContinuation,
        completesPendingEffectContinuation: pendingEffects.length === 0 && input.hasPendingEffectRecovery,
        effectsPending: input.receipt.outcome === 'partially-committed',
    };
}
