import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { type ProofPatch } from '../../models/ProofPatch';
import { getProofPatchParameterValues } from '../../services/getProofPatchParameterValues';
import { loadProofPatch } from '../../stores/proofStore';

import { syncFullPatch } from './syncFullPatch';

type LoadProofPatchWithAudioInput = {
    deviceId: string;
    patch: ProofPatch;
};

export function loadProofPatchWithAudio({ deviceId, patch }: LoadProofPatchWithAudioInput): void {
    loadProofPatch({ deviceId, patch });
    persistDevicePatch(deviceId, getProofPatchParameterValues(patch));
    syncFullPatch(deviceId);
}
