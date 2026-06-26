import { type ProofPatch } from '../../models/ProofPatch';
import { loadProofPatch } from '../../stores/proofStore';

import { syncFullPatch } from './syncFullPatch';

type LoadProofPatchWithAudioInput = {
    deviceId: string;
    patch: ProofPatch;
};

export function loadProofPatchWithAudio({ deviceId, patch }: LoadProofPatchWithAudioInput): void {
    loadProofPatch({ deviceId, patch });
    syncFullPatch(deviceId);
}
