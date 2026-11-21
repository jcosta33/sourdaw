import { isDrumDevice as isDrumDeviceType } from '#/modules/AudioEngine/useCases';

/**
 * The drum-family test the live scheduler shares with the offline renderer and
 * every other route. AudioEngine owns the answer (its note-input table); this
 * wrapper keeps the live scheduling call sites on their local import.
 */
export function isDrumDevice(deviceType: string): boolean {
    return isDrumDeviceType(deviceType);
}
