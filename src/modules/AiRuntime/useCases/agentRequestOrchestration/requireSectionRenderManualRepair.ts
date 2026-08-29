import { logger } from '#/infra/logger/appLogger';
import { type compileVersionedCommandBatchEnvelope, type createVerifiedBatchReceipt } from '#/modules/Command/useCases';

import { agentRunLifecycle } from '../agentRunLifecycle';

const RENDER_MANUAL_REPAIR_PERSISTENCE_WARNING =
    'The retained render manual-repair state could not be persisted. Do not reconcile or replay this committed batch until durable run state is repaired.';

export function requireSectionRenderManualRepair(input: {
    runId: string;
    batchId: string;
    reason: string;
    missingEffect?: {
        commandId: string;
        existingEffects: ReturnType<typeof createVerifiedBatchReceipt>['pendingEffects'];
        receiptIdentity: string;
        serializedBatch: string;
        authority: ReturnType<typeof compileVersionedCommandBatchEnvelope>['authority'];
    };
}): string | null {
    try {
        if (input.missingEffect) {
            agentRunLifecycle.recordPendingEffectContinuation({
                runId: input.runId,
                continuation: {
                    authority: structuredClone(input.missingEffect.authority),
                    batchId: input.batchId,
                    effects: [
                        ...structuredClone(input.missingEffect.existingEffects),
                        {
                            commandId: input.missingEffect.commandId,
                            kind: 'external-effect',
                            operation: 'renderProjectSections',
                            reason: input.reason,
                            remediation: 'manual-repair',
                            state: 'pending',
                        },
                    ],
                    lastError: input.reason,
                    receiptIdentity: input.missingEffect.receiptIdentity,
                    recovery: 'manual-repair',
                    serializedBatch: input.missingEffect.serializedBatch,
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
