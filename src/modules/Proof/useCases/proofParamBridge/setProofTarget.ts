import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { type ProofTarget } from '../../models/ProofPatch';
import { proofTargetToInt } from '../../services/proofTargetCodec';
import { updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';
import { syncFullPatch } from './syncFullPatch';

type SetProofTargetInput = {
    deviceId: string;
    target: ProofTarget;
    targetLufs: number;
};

export function setProofTarget({ deviceId, target, targetLufs }: SetProofTargetInput): void {
    if (!bridges.has(deviceId)) {
        syncFullPatch(deviceId);
    }

    updateProofPatch({ deviceId, patch: { target, targetLufs } });
    persistDevicePatch(deviceId, {
        target_mode: proofTargetToInt(target),
        target_lufs: targetLufs,
    });
}
