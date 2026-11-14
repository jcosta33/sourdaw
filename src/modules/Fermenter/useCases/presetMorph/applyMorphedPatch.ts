import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatchWithAudio } from '../fermenterParamBridge/loadFermenterPatchWithAudio';

/** Morph shares the same last-write-per-frame project and runtime path as macros. */
export function applyMorphedPatch(deviceId: string, patch: FermenterPatch): void {
    loadFermenterPatchWithAudio(deviceId, patch);
}
