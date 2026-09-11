import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { TARGET_LUFS, type ProofTarget } from '../../models/ProofPatch';
import { isValidProofPatch } from '../../services/isValidProofPatch';
import { proofTargetToInt } from '../../services/proofTargetCodec';
import { getProofState, updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';
import { rehydrateRestoredPatch } from './rehydrateRestoredPatch';

type SetProofTargetInput = {
    deviceId: string;
    target: ProofTarget;
};

export function setProofTarget({ deviceId, target }: SetProofTargetInput): void {
    if (!Object.hasOwn(TARGET_LUFS, target)) {
        return;
    }

    const writeTarget = resolveEligibleDeviceWriteTarget(deviceId);
    if (writeTarget.status !== 'eligible') {
        return;
    }

    // Before bridge registration, hydrate the store from the persisted row so
    // this edit applies over restored values; the engine hears only the edit,
    // because a natively carried body already holds the persisted record and
    // the web twin takes its full sync at registration.
    if (!bridges.has(deviceId)) {
        rehydrateRestoredPatch(deviceId);
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
