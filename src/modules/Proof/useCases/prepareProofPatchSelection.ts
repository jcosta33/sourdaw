import { captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';

import { type ProofPatchSelection } from '../events/proofAppActions';

import { readProofPatchSelectionOwner } from './readProofPatchSelectionOwner';
import { selectProofPatch } from './selectProofPatch';

/** Keep a click bound to its original owner while a ceiling gesture settles. */
export function prepareProofPatchSelection(deviceId: string, selection: ProofPatchSelection): () => void {
    const parameterIds: readonly string[] = [];
    const owner = readProofPatchSelectionOwner(deviceId, parameterIds);
    if (!owner) {
        return () => undefined;
    }
    const authority = captureDevicePatchCommitValidation({
        trackId: owner.trackId,
        deviceId,
        parameterIds,
        requireCurrentProjection: true,
    });
    return () => {
        if (authority?.isCurrent()) {
            void selectProofPatch(deviceId, selection);
        }
    };
}
