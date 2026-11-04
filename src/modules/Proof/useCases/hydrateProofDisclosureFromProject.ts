import { trackStore } from '#/modules/Arrangement/stores';

import { proofDisclosureLevelFromState } from '../models/ProofDisclosure';
import { getProofState, setProofUiLevel } from '../stores/proofStore';

/** Re-project UI metadata without replacing the live patch or touching meters/audio. */
export function hydrateProofDisclosureFromProject(deviceId: string): void {
    const device = trackStore.value?.tracks
        .flatMap((track) => track.devices)
        .find((candidate) => candidate.id === deviceId && candidate.type === 'proof');
    if (!device) {
        return;
    }
    const level = proofDisclosureLevelFromState(device.deviceState);
    if (getProofState(deviceId).uiLevel !== level) {
        setProofUiLevel({ deviceId, level });
    }
}
