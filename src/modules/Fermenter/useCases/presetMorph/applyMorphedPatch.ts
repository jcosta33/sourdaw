import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { setFermenterParamWithAudio } from '../fermenterParamBridge/setFermenterParamWithAudio';

/**
 * Apply a morphed patch — updates both the store and the audio engine.
 */
export function applyMorphedPatch(deviceId: string, patch: FermenterPatch): void {
    loadFermenterPatch(deviceId, patch);
    for (const [key, val] of Object.entries(patch)) {
        if (typeof val === 'number') {
            setFermenterParamWithAudio(deviceId, key as keyof FermenterPatch, val);
        }
    }
}