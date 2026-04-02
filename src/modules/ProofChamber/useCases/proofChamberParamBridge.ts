/**
 * ProofChamber (Dutch Oven) parameter bridge — forwards UI param changes
 * to the WASM audio engine. Finds all active proof-chamber devices on
 * tracks and pushes param updates to each one.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheStaleTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) {
        return cachedRefs;
    }

    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'native-proof-chamber' || device.type === 'proof-chamber') {
                refs.push({ trackId: track.id, deviceId: device.id });
            }
        }
    }
    cachedRefs = refs;

    if (cacheStaleTimer) {
        clearTimeout(cacheStaleTimer);
    }
    cacheStaleTimer = setTimeout(() => {
        cachedRefs = null;
    }, 2000);

    return refs;
}

/**
 * Send a single parameter change to all active ProofChamber instances.
 * `rustParamName` is the engine-side name (from PARAM_MAP), not the UI key.
 */
export function updateProofChamberParam(rustParamName: string, value: number): void {
    for (const { trackId, deviceId } of getActiveDevices()) {
        updateDeviceParam(trackId, deviceId, rustParamName, value);
    }
}
