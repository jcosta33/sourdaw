import { handleSetProofPatchSelection } from '../handlers/handleSetProofPatchSelection';

export function getProofHandlers() {
    return { setProofPatchSelection: handleSetProofPatchSelection };
}
