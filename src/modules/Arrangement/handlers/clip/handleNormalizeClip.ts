import { createHandler } from '#/utils/createHandler';

import { getClipNormalizationTargetGain } from '../../useCases/clipEditing/getClipNormalizationTargetGain';
import { normalizeClip } from '../../useCases/clipEditing/normalizeClip';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleNormalizeClip = createHandler<'normalizeClip'>({
    execute: (alpha) => {
        const didWrite = normalizeClip(alpha.payload.clipId, alpha.payload.mode, alpha.payload.targetDb);
        return toHandlerExecutionResult(didWrite);
    },
    describe: (alpha) => {
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === alpha.payload.clipId);
        // Same computation `normalizeClip` uses to pick its write target gain — reusing it here,
        // before execute runs, lets the inverse carry the exact post-normalize gain as its replay
        // guard, so a stale replay refuses instead of silently overwriting a diverged gain.
        const targetGain = getClipNormalizationTargetGain(
            alpha.payload.clipId,
            alpha.payload.mode,
            alpha.payload.targetDb
        );
        const mode = alpha.payload.mode ?? 'peak';
        let label: string;
        if (mode === 'peak') {
            label = `Normalize clip ${alpha.payload.clipId} using peak measurement`;
        } else {
            const targetDb = alpha.payload.targetDb ?? -14;
            if (mode === 'lufs') {
                label = `Normalize clip ${alpha.payload.clipId} to ${targetDb} LUFS`;
            } else {
                label = `Normalize clip ${alpha.payload.clipId} to ${targetDb} dB RMS`;
            }
        }

        return {
            label,
            inverseAction:
                clip && targetGain !== null
                    ? {
                          type: 'setClipGain',
                          payload: { clipId: alpha.payload.clipId, gain: clip.gain, expectedGain: targetGain },
                      }
                    : null,
        };
    },
    isNoop: (alpha) => {
        const targetGain = getClipNormalizationTargetGain(
            alpha.payload.clipId,
            alpha.payload.mode,
            alpha.payload.targetDb
        );
        const clip = getTrackStoreState()
            ?.tracks.flatMap((track) => track.clips)
            .find((candidate) => candidate.id === alpha.payload.clipId);
        return targetGain !== null && clip !== undefined && Object.is(clip.gain, targetGain);
    },
    undoable: true,
});
