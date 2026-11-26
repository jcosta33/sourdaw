import { type AgentRun } from '../../models/AgentRun';
import { type AgentRunPlanBoundRefusal } from '../../validators/readAgentRunPlanBoundRefusal';
import { agentRunLifecycle } from '../agentRunLifecycle';

import { buildPreviewEvidenceRecord, type PreviewReceipts } from './buildPreviewEvidenceRecord';

/**
 * Whether the run's plan could keep a batch's preview receipts, with nothing written. A caller that
 * writes the plan later, once its card is stored, asks first so a refusal still comes before any work.
 */
export function admitBatchPreviewEvidence(
    liveRun: AgentRun,
    revision: string,
    metricGoalState: string | null | undefined,
    receipts: PreviewReceipts
): AgentRunPlanBoundRefusal | null {
    if (!liveRun.plan) {
        return null;
    }
    return agentRunLifecycle.admitPlan(
        buildPreviewEvidenceRecord({ liveRun, plan: liveRun.plan, revision, metricGoalState, receipts })
    );
}
