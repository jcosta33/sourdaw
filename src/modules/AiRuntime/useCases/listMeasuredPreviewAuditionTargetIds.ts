import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { getPendingActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { digestCommandBatchContent } from './digestCommandBatchContent';
import { metricGoalStateCodec } from './metricGoalStateCodec';

/**
 * The targets an audition of this proposal can compare: those of the preview proofs in its
 * metric-goal state that measured the card's own batch content. No proof, no comparison.
 */
export function listMeasuredPreviewAuditionTargetIds(confirmationId: string): string[] {
    const confirmation = getPendingActionConfirmation(confirmationId);
    const batch = confirmation?.approvalSnapshot.commandBatch;
    const parsed = batch === undefined ? null : parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
    const hash = parsed?.status === 'valid' ? digestCommandBatchContent(parsed.envelope) : null;
    const goals = metricGoalStateCodec(confirmation?.approvalSnapshot.metricGoalState);
    const ids = new Set(
        (goals?.proofs ?? [])
            .filter((proof) => proof.preview.batchContentHash === hash)
            .flatMap((proof) => proof.preview.targets.map((target) => target.targetId))
    );
    return Array.from(ids);
}
