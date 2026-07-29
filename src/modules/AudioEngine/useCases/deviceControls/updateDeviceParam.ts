import { clampDeviceParamWrite } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../repositories/createWebAudioEngine';

/**
 * The single door every device-parameter write reaches the DSP through.
 *
 * The declared range binds here rather than at each caller. Twenty call sites
 * reach the engine this way — the synth param bridges, preset load, the
 * project-open strip rebuild, `addDevice` defaults, automation and modulation —
 * and clamping any subset of them produces the worse failure, not a better one:
 * the store row lands inside the declared range while the audible value does
 * not, and the two then disagree about what the parameter is.
 *
 * The store-side twin is `persistDeviceParam`, which clamps with the device
 * already in hand; both read the same law so there is one definition of what a
 * declared range means.
 */
export function updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
    audioEngine.updateDeviceParam(trackId, deviceId, paramId, clampDeviceParamWrite({ deviceId, paramId, value }));
}
