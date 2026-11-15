import { trackStore } from '#/modules/Arrangement/stores';

import { measuredPreviewAuditionStore } from '../stores/measuredPreviewAuditionStore';

import { listMeasuredPreviewAuditionTargetIds } from './listMeasuredPreviewAuditionTargetIds';
import { resolveMeasuredPreviewAudition } from './resolveMeasuredPreviewAudition';

/** Read a musician-facing projection; no buffer, retained address or permit crosses this boundary. */
export function getMeasuredPreviewAuditionView(input: {
    confirmationId: string;
    selectedIntentGroupIds?: readonly string[];
}) {
    const targets = listMeasuredPreviewAuditionTargetIds(input.confirmationId).map((targetId) => {
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
