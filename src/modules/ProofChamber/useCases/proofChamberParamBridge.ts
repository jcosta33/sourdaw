/**
 * ProofChamber (Dutch Oven) parameter bridge — forwards UI param changes
 * to the WASM audio engine for the specific device instance.
 */
import { getAllTracks } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

type DeviceRef = { trackId: string; deviceId: string };

function createFindDeviceRef(getAllTracksFn: typeof getAllTracks) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}

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
