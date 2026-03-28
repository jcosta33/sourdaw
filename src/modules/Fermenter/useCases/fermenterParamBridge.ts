/**
 * Bridge between FermenterPanel UI and the audio engine.
 *
 * Finds all Fermenter devices across tracks and forwards param changes
 * to both the UI store and the audio engine's WASM worklet.
 */

import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { getAllTracks } from '#/modules/Arrangement/repositories/track/queries';
import { type FermenterPatch } from '../models/FermenterPatch';
import { setFermenterParam } from '../stores/fermenterStore';

/**
 * Set a Fermenter parameter — updates both the UI store and ALL active
 * Fermenter audio engine instances.
 */
export function setFermenterParamWithAudio(key: keyof FermenterPatch, value: number): void {
    // Update UI store
    setFermenterParam(key, value);

    // Forward to every Fermenter device on every track
    const tracks = getAllTracks();
    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.type === 'fermenter') {
                updateDeviceParam(track.id, device.id, key, value);
            }
        }
    }
}
