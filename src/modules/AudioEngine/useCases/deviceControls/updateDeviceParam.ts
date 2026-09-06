import { clampDeviceParamWrite } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../repositories/createWebAudioEngine';
import { sendNativeDeviceParameters } from '../livePlayback/sendNativeDeviceParameters';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';

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
 *
 * Which DSP that is depends on who is carrying the device: a built-in the
 * native session carries takes the value over the graph command path, in the
 * engine's own name for the parameter, and never over the web path as well —
 * see {@link nativeBuiltinWriteTarget} for why both would be one too many.
 */
export function updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
    const clamped = clampDeviceParamWrite({ deviceId, paramId, value });
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (body) {
        void sendNativeDeviceParameters({ trackId, deviceId, values: { [body.parameterName(paramId)]: clamped } });
        return;
    }
    audioEngine.updateDeviceParam(trackId, deviceId, paramId, clamped);
}
