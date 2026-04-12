/**
 * ProofChamber (Dutch Oven) parameter bridge — forwards UI param changes
 * to the WASM audio engine for the specific device instance.
 */
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createFindDeviceRef } from '#/utils/createFindDeviceRef';

const findDeviceRef = createFindDeviceRef(getAllTracks);

/**
 * Send a single parameter change to a specific ProofChamber instance.
 * `rustParamName` is the engine-side name (from PARAM_MAP), not the UI key.
 */
export function updateProofChamberParam(deviceId: string, rustParamName: string, value: number): void {
    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }
    updateDeviceParam(ref.trackId, ref.deviceId, rustParamName, value);
}
