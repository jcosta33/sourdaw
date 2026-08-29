import { logger } from '#/infra/logger/appLogger';
import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { type AgentRunPendingEffect } from '../../models/AgentRun';
import { agentRunLifecycle } from '../agentRunLifecycle';

const RENDER_MANUAL_REPAIR_PERSISTENCE_WARNING =
    'The retained render manual-repair state could not be persisted. Do not reconcile or replay this committed batch until durable run state is repaired.';

function createMissingRenderEffects(commandIds: readonly string[], reason: string): AgentRunPendingEffect[] {
    return commandIds.map((commandId) => ({
        commandId,
        kind: 'external-effect',
        operation: 'renderProjectSections',
        reason,
        remediation: 'manual-repair',
        state: 'pending',
    }));
}

function normalizeTargetedRenderEffect(
    effect: AgentRunPendingEffect,
    targetedCommandIds: ReadonlySet<string>
): AgentRunPendingEffect {
    if (
        !targetedCommandIds.has(effect.commandId) ||
        effect.kind !== 'external-effect' ||
        effect.operation !== 'renderProjectSections'
    ) {
        return effect;
    }
    return { ...effect, remediation: 'manual-repair' };
}

export function requireSectionRenderManualRepair(input: {
    runId: string;
    batchId: string;
    reason: string;
    missingEffects?: {
        commandIds: readonly string[];
        existingEffects: ReturnType<typeof createVerifiedBatchReceipt>['pendingEffects'];
        receiptIdentity: string;
        serializedBatch: string;
        authority: ReturnType<typeof compileVersionedCommandBatchEnvelope>['authority'];
    };
}): string | null {
    try {
        if (input.missingEffects) {
            const targetedCommandIds = new Set(input.missingEffects.commandIds);
            const normalizedExistingEffects = input.missingEffects.existingEffects.map((effect) =>
                normalizeTargetedRenderEffect(effect, targetedCommandIds)
            );
            const existingCommandIds = new Set(normalizedExistingEffects.map(({ commandId }) => commandId));
            const missingCommandIds = input.missingEffects.commandIds.filter(
                (commandId, index, commandIds) =>
                    !existingCommandIds.has(commandId) && commandIds.indexOf(commandId) === index
            );
            agentRunLifecycle.recordPendingEffectContinuation({
                runId: input.runId,
                continuation: {
                    authority: structuredClone(input.missingEffects.authority),
                    batchId: input.batchId,
                    effects: [
                        ...structuredClone(normalizedExistingEffects),
                        ...createMissingRenderEffects(missingCommandIds, input.reason),
                    ],
                    lastError: input.reason,
                    receiptIdentity: input.missingEffects.receiptIdentity,
                    recovery: 'manual-repair',
                    serializedBatch: input.missingEffects.serializedBatch,
                },
            });
            return null;
        }
        agentRunLifecycle.requirePendingEffectManualRepair(input);
        return null;
    } catch (error) {
        logger.error(new Error('Agent render manual-repair state could not be persisted', { cause: error }));
        return RENDER_MANUAL_REPAIR_PERSISTENCE_WARNING;
    }
}
