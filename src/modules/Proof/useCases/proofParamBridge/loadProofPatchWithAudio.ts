import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';

import { type ProofPatch } from '../../models/ProofPatch';
import { isValidProofPatch } from '../../services/isValidProofPatch';
import { loadProofPatch } from '../../stores/proofStore';

import { syncFullPatch } from './syncFullPatch';

type LoadProofPatchWithAudioInput = {
    deviceId: string;
    patch: ProofPatch;
};

export function loadProofPatchWithAudio({ deviceId, patch }: LoadProofPatchWithAudioInput): void {
    if (!isValidProofPatch(patch)) {
        return;
    }

    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    loadProofPatch({ deviceId, patch });
    syncFullPatch(deviceId);
}
