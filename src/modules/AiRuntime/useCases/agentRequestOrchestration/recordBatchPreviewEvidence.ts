import { type AgentRun } from '../../models/AgentRun';
import { type AgentRunPlanBoundRefusal } from '../../validators/readAgentRunPlanBoundRefusal';
import { agentRunLifecycle } from '../agentRunLifecycle';

import { buildPreviewEvidenceRecord, type PreviewReceipts, type PreviewedBatch } from './buildPreviewEvidenceRecord';

/**
 * The run keeps the batch's measured goal state and every receipt its preview read, after those of
 * earlier batches. Given the previewed batch, the plan also records the audible claim its proofs
 * verify; without it the plan restates the frozen predictions unverified. A plan that could not keep
 * them is refused before anything is written, and the refusal is returned for the caller to report.
 */
export function recordBatchPreviewEvidence(
    liveRun: AgentRun,
    revision: string,
    metricGoalState: string | null | undefined,
    receipts: PreviewReceipts,
    batch?: PreviewedBatch
): AgentRunPlanBoundRefusal | null {
    if (!liveRun.plan) {
        return null;
    }
    const record = buildPreviewEvidenceRecord({
        liveRun,
        plan: liveRun.plan,
        revision,
        metricGoalState,
        receipts,
        batch,
    });
    const refusal = agentRunLifecycle.admitPlan(record);
    if (refusal === null) {
        agentRunLifecycle.recordPlan(record);
    }
    return refusal;
}
