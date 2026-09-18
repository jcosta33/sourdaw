import { admitAgentRenderReceipt } from '#/modules/Arrangement/useCases';
import { getAgentSectionRenderArtifacts } from '#/modules/AudioRendering/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { retainedRenderReceipts, type RenderedReceipt } from './retainedRenderReceipts';

type RenderReceiptGatedAction = Extract<AppAction, { type: 'bounceSelection' | 'consolidateSelection' }>;

function isRenderReceiptGatedAction(action: AppAction): action is RenderReceiptGatedAction {
    return action.type === 'bounceSelection' || action.type === 'consolidateSelection';
}

function findNewestMatchingReceipt(
    receipts: readonly RenderedReceipt[],
    action: RenderReceiptGatedAction
): RenderedReceipt | null {
    const matching = receipts.filter(
        (receipt) =>
            receipt.provenance.startBeat === action.payload.startBeat &&
            receipt.provenance.endBeat === action.payload.endBeat
    );
    return matching.reduce<RenderedReceipt | null>(
        (newest, candidate) => (!newest || candidate.renderedAt > newest.renderedAt ? candidate : newest),
        null
    );
}

export type RenderReceiptAdmissionFailure = { reason: string; stale: boolean };

/**
 * Blocks a confirmed batch before its flight starts when it carries a range mutation whose
 * bounce/consolidate range this run previously rendered and that render no longer admits the
 * mutation. Actions whose range this run never rendered are untouched — the mutation is ordinary,
 * not agent-render-gated. A retained receipt whose artifact is already gone is released and
 * skipped: nothing remains for a mutation to consume, so the mutation is ordinary too.
 */
export function getRenderReceiptAdmissionFailure(input: {
    runId: string;
    liveRun: { runId: string; cancellationGeneration: number } | null;
    actions: readonly AppAction[];
}): RenderReceiptAdmissionFailure | null {
    const { runId, liveRun, actions } = input;
    const gatedActions = actions.filter(isRenderReceiptGatedAction);
    if (gatedActions.length === 0) {
        return null;
    }
    const artifacts = getAgentSectionRenderArtifacts();
    const retainedJobIds = new Set(artifacts.map(({ jobId }) => jobId));
    for (const receipt of retainedRenderReceipts.getRetained(runId)) {
        if (!retainedJobIds.has(receipt.provenance.jobId)) {
            retainedRenderReceipts.release(runId, receipt.provenance.jobId);
        }
    }
    const retainedReceipts = retainedRenderReceipts.getRetained(runId);
    for (const action of gatedActions) {
        const receipt = findNewestMatchingReceipt(retainedReceipts, action);
        if (!receipt) {
            continue;
        }
        const admission = admitAgentRenderReceipt({
            receipt,
            liveRun,
            mutation: {
                type: action.type,
                trackId: action.payload.trackId,
                startBeat: action.payload.startBeat,
                endBeat: action.payload.endBeat,
            },
            artifacts,
        });
        if (admission.status === 'rejected') {
            return {
                reason: `Rendered section ${receipt.provenance.jobId} no longer admits ${action.type} (${admission.reason})`,
                stale: admission.reason === 'stale-revision',
            };
        }
    }
    return null;
}
