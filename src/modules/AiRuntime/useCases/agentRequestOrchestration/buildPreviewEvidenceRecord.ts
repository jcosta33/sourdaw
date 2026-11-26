import { type AgentRun, type AgentRunPlan } from '../../models/AgentRun';
import { deriveAudibleImpact } from '../deriveAudibleImpact';
import { metricGoalStateCodec } from '../metricGoalStateCodec';
import { type prepareMetricGoalPreview } from '../prepareMetricGoalPreview';

export type PreviewedBatch = Pick<Parameters<typeof deriveAudibleImpact>[0], 'commandBatch' | 'envelope'>;

export type PreviewReceipts = Awaited<ReturnType<typeof prepareMetricGoalPreview>>['receipts'];

type PreviewEvidenceInput = {
    liveRun: AgentRun;
    plan: AgentRunPlan;
    revision: string;
    metricGoalState: string | null | undefined;
    receipts: PreviewReceipts;
    batch?: PreviewedBatch;
};

export function buildPreviewEvidenceRecord(input: PreviewEvidenceInput) {
    const { liveRun, plan, receipts } = input;
    const priorReceipts = plan.applicationToolReceipts ?? [];
    return {
        runId: liveRun.runId,
        summary: plan.summary,
        commandIds: plan.commandIds,
        serializedBatchIdentity: plan.serializedBatchIdentity,
        revision: input.revision,
        scope: liveRun.scope,
        grants: liveRun.grants,
        budgets: liveRun.budgets,
        plan: {
            ...plan,
            metricGoalState: input.metricGoalState ?? undefined,
            applicationToolReceipts: [...priorReceipts, ...receipts],
        },
        audibleClaim: readVerifiedAudibleClaim(metricGoalStateCodec(input.metricGoalState), input.batch),
    };
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
