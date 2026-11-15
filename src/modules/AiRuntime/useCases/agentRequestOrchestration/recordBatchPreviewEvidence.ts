import { type AgentRun } from '../../models/AgentRun';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { type prepareMetricGoalPreview } from '../prepareMetricGoalPreview';

/** The run keeps the batch's measured goal state and every receipt its preview read, after those of earlier batches. */
export function recordBatchPreviewEvidence(
    liveRun: AgentRun,
    revision: string,
    metricGoalState: string | undefined,
    receipts: Awaited<ReturnType<typeof prepareMetricGoalPreview>>['receipts']
): void {
    if (!liveRun.plan) {
        return;
    }
    const priorReceipts = liveRun.plan.applicationToolReceipts ?? [];
    agentRunLifecycle.recordPlan({
        runId: liveRun.runId,
        summary: liveRun.plan.summary,
        commandIds: liveRun.plan.commandIds,
        serializedBatchIdentity: liveRun.plan.serializedBatchIdentity,
        revision,
        scope: liveRun.scope,
        grants: liveRun.grants,
        budgets: liveRun.budgets,
        plan: {
            ...liveRun.plan,
            metricGoalState,
            applicationToolReceipts: [...priorReceipts, ...receipts],
        },
    });
}
