import { trackStore } from '#/modules/Arrangement/stores';
import { parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { measuredPreviewAuditionStore } from '../stores/measuredPreviewAuditionStore';
import { getPendingActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { digestCommandBatchContent } from './digestCommandBatchContent';
import { metricGoalStateCodec } from './metricGoalStateCodec';
import { resolveMeasuredPreviewAudition } from './resolveMeasuredPreviewAudition';

/** Read a musician-facing projection; no buffer, retained address or permit crosses this boundary. */
export function getMeasuredPreviewAuditionView(input: {
    confirmationId: string;
    selectedIntentGroupIds?: readonly string[];
}) {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    const batch = confirmation?.approvalSnapshot.commandBatch;
    const parsed = batch === undefined ? null : parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
    const hash = parsed?.status === 'valid' ? digestCommandBatchContent(parsed.envelope) : null;
    const goals = metricGoalStateCodec(confirmation?.approvalSnapshot.metricGoalState);
    const ids = new Set(
        (goals?.proofs ?? [])
            .filter((proof) => proof.preview.batchContentHash === hash)
            .flatMap((proof) => proof.preview.targets.map((target) => target.targetId))
    );
    const targets = Array.from(ids, (targetId) => {
        const resolved = resolveMeasuredPreviewAudition({ ...input, targetId });
        let targetName = 'Master output';
        if (targetId !== 'master') {
            targetName = trackStore.value?.tracks.find((track) => track.id === targetId)?.name ?? targetId;
        }
        if (resolved.status === 'unavailable') {
            return { targetId, targetName, available: false as const, reason: resolved.reason };
        }
        return {
            targetId,
            targetName,
            available: true as const,
            reason: null,
            baselineLufs: resolved.baseline.lufs,
            proposalLufs: resolved.preview.lufs,
            matchedLufs: resolved.matchLufs,
        };
    });
    const state = measuredPreviewAuditionStore.value;
    const active = state?.confirmationId === input.confirmationId ? state : null;
    return {
        confirmationId: input.confirmationId,
        targets,
        phase: active?.phase ?? 'idle',
        side: active?.side ?? null,
        targetId: active?.targetId ?? null,
        error: active?.error ?? null,
        reason: targets.length === 0 ? 'Measure this exact proposal to retain audio for comparison.' : null,
    };
}
