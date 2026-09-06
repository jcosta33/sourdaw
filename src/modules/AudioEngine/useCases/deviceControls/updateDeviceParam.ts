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
 * The Web Audio write always happens: while the native session carries the
 * device it is the sound, but its Web Audio node is the strip's fallback
 * carrier, silent only for as long as the session holds the gate closed on it,
 * and it has to already hold the current value for the moment that gate
 * reopens at Stop. The native send in {@link nativeBuiltinWriteTarget} is
 * additive on top of that, in the engine's own name for the parameter, for
 * whichever built-in the native session is carrying right now.
 */
export function updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
    const clamped = clampDeviceParamWrite({ deviceId, paramId, value });
    audioEngine.updateDeviceParam(trackId, deviceId, paramId, clamped);
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (body) {
        void sendNativeDeviceParameters({ trackId, deviceId, values: { [body.parameterName(paramId)]: clamped } });
    }
}
