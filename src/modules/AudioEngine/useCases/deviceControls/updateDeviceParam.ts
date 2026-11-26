import { clampDeviceParamWrite } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../repositories/createWebAudioEngine';

import { nativeBuiltinWriteTarget } from './nativeBuiltinWriteTarget';
import { withDeviceParameterRuntimeWriteOwner } from './withDeviceParameterRuntimeWriteOwner';
import { writeNativeBuiltinParameters } from './writeNativeBuiltinParameters';

function writeWebDeviceParam(
    trackId: string,
    deviceId: string,
    paramId: string,
    value: number,
    runtimeOwner?: symbol
): number {
    const clamped = clampDeviceParamWrite({ deviceId, paramId, value });
    withDeviceParameterRuntimeWriteOwner(trackId, deviceId, paramId, runtimeOwner, () => {
        audioEngine.updateDeviceParam(trackId, deviceId, paramId, clamped);
    });
    return clamped;
}

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
 * whichever built-in the native session is carrying right now. It leaves
 * through {@link writeNativeBuiltinParameters}, so this door and the
 * engine-named door of a built-in whose controls are not `parameterValues`
 * entries share one send path.
 */
export function updateDeviceParam(
    trackId: string,
    deviceId: string,
    paramId: string,
    value: number,
    runtimeOwner?: symbol
): void {
    const clamped = writeWebDeviceParam(trackId, deviceId, paramId, value, runtimeOwner);
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (body) {
        writeNativeBuiltinParameters(trackId, deviceId, { [body.parameterName(paramId)]: clamped });
    }
}

/** Apply ordered project parameters to Web Audio and send one batch to the carried native body. */
export function updateDeviceParameters(
    trackId: string,
    deviceId: string,
    parameters: readonly (readonly [paramId: string, value: number])[]
): void {
    if (parameters.length === 0) {
        return;
    }
    const clamped: [string, number][] = [];
    for (const [paramId, value] of parameters) {
        clamped.push([paramId, writeWebDeviceParam(trackId, deviceId, paramId, value)]);
    }
    const body = nativeBuiltinWriteTarget(trackId, deviceId);
    if (body) {
        const values = Object.fromEntries(clamped.map(([paramId, value]) => [body.parameterName(paramId), value]));
        writeNativeBuiltinParameters(trackId, deviceId, values);
    }
}
