import { type AgentRun } from '../../models/AgentRun';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { deriveAudibleImpact } from '../deriveAudibleImpact';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { type prepareMetricGoalPreview } from '../prepareMetricGoalPreview';

type PreviewedBatch = Pick<Parameters<typeof deriveAudibleImpact>[0], 'commandBatch' | 'envelope'>;

/**
 * The run keeps the batch's measured goal state and every receipt its preview read, after those of
 * earlier batches. Given the previewed batch, the plan also records the audible claim its proofs
 * verify; without it the plan restates the frozen predictions unverified.
 */
export function recordBatchPreviewEvidence(
    liveRun: AgentRun,
    revision: string,
    metricGoalState: string | undefined,
    receipts: Awaited<ReturnType<typeof prepareMetricGoalPreview>>['receipts'],
    batch?: PreviewedBatch
): void {
    if (!liveRun.plan) {
        return;
    }
    const priorReceipts = liveRun.plan.applicationToolReceipts ?? [];
    const state = metricGoalStateCodec(metricGoalState);
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
        audibleClaim: readVerifiedAudibleClaim(state, batch),
    });
}

function readVerifiedAudibleClaim(state: ReturnType<typeof metricGoalStateCodec>, batch: PreviewedBatch | undefined) {
    if (batch === undefined) {
        return undefined;
    }
    const claim = deriveAudibleImpact({
        ...batch,
        state,
        snapshotPreview: undefined,
        proofPreviews: state?.proofs.map((entry) => entry.preview) ?? [],
    });
    return claim ?? undefined;
}
