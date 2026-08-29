import { logger } from '#/infra/logger/appLogger';

import { agentRunLifecycle } from '../agentRunLifecycle';

const RENDER_MANUAL_REPAIR_PERSISTENCE_WARNING =
    'The retained render manual-repair state could not be persisted. Do not reconcile or replay this committed batch until durable run state is repaired.';

export function requireSectionRenderManualRepair(input: {
    runId: string;
    batchId: string;
    reason: string;
}): string | null {
    try {
        agentRunLifecycle.requirePendingEffectManualRepair(input);
        return null;
    } catch (error) {
        logger.error(new Error('Agent render manual-repair state could not be persisted', { cause: error }));
        return RENDER_MANUAL_REPAIR_PERSISTENCE_WARNING;
    }
}
