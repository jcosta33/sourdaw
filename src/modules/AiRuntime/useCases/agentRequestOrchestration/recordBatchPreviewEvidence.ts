import { type AgentRun } from '../../models/AgentRun';
import { type AgentRunPlanBoundRefusal } from '../../validators/readAgentRunPlanBoundRefusal';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { deriveAudibleImpact } from '../deriveAudibleImpact';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { type prepareMetricGoalPreview } from '../prepareMetricGoalPreview';

type PreviewedBatch = Pick<Parameters<typeof deriveAudibleImpact>[0], 'commandBatch' | 'envelope'>;

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
    receipts: Awaited<ReturnType<typeof prepareMetricGoalPreview>>['receipts'],
    batch?: PreviewedBatch
): AgentRunPlanBoundRefusal | null {
    if (!liveRun.plan) {
        return null;
    }
    const priorReceipts = liveRun.plan.applicationToolReceipts ?? [];
    const state = metricGoalStateCodec(metricGoalState);
    const record = {
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
            metricGoalState: metricGoalState ?? undefined,
            applicationToolReceipts: [...priorReceipts, ...receipts],
        },
        audibleClaim: readVerifiedAudibleClaim(state, batch),
    };
    const refusal = agentRunLifecycle.admitPlan(record);
    if (refusal === null) {
        agentRunLifecycle.recordPlan(record);
    }
    return refusal;
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
