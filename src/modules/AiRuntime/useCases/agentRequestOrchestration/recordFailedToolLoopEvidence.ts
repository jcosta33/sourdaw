import { logger } from '#/infra/logger/appLogger';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { readApplicationToolOnlyEvidence } from '../../transformers/readApplicationToolOnlyEvidence';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { ApplicationOwnedToolLoopRequestError } from '../applicationOwnedToolLoop';
import { describeAgentRunPlanBoundRefusal } from '../describeAgentRunPlanBoundRefusal';

/**
 * A failed tool loop's receipts are kept when the run's plan can hold them. The loop's own failure is
 * what the user is told, so receipts the plan could not persist are logged and left out, never thrown
 * over that failure.
 */
export function recordFailedToolLoopEvidence(runId: string, error: unknown): void {
    if (!(error instanceof ApplicationOwnedToolLoopRequestError) || error.receipts.length === 0) {
        return;
    }
    const evidence = readApplicationToolOnlyEvidence({
        runId,
        revision: error.receipts.find((receipt) => receipt.revision !== null)?.revision ?? captureProjectRevision(),
        receipts: error.receipts,
    });
    const refusal = agentRunLifecycle.admitApplicationToolEvidence(evidence);
    if (refusal !== null) {
        logger.warn(`Failed tool loop receipts were not kept: ${describeAgentRunPlanBoundRefusal(refusal)}`);
        return;
    }
    agentRunLifecycle.recordApplicationToolEvidence(evidence);
}
