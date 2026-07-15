import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { TARGET_LUFS, type ProofTarget } from '../../models/ProofPatch';
import { isValidProofPatch } from '../../services/isValidProofPatch';
import { proofTargetToInt } from '../../services/proofTargetCodec';
import { getProofState, updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';
import { syncFullPatch } from './syncFullPatch';

type SetProofTargetInput = {
    deviceId: string;
    target: ProofTarget;
};

export function setProofTarget({ deviceId, target }: SetProofTargetInput): void {
    if (!Object.hasOwn(TARGET_LUFS, target)) {
        return;
    }
    if (!bridges.has(deviceId)) {
        syncFullPatch(deviceId);
    }

    const targetLufs = TARGET_LUFS[target];
    const currentPatch = getProofState(deviceId).patch;
    if (!isValidProofPatch({ ...currentPatch, target, targetLufs })) {
        return;
    }
    if (currentPatch.target === target && currentPatch.targetLufs === targetLufs) {
        return;
    }

    updateProofPatch({ deviceId, patch: { target, targetLufs } });
    persistDevicePatch(deviceId, {
        target_mode: proofTargetToInt(target),
        target_lufs: targetLufs,
    });
}
