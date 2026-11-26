import { clampDeviceParamWrite } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../repositories/createWebAudioEngine';

import { withDeviceParameterRuntimeWriteOwner } from './withDeviceParameterRuntimeWriteOwner';

/** Clamp the project value and scope the Web Audio write to its parameter owner. */
export function writeWebDeviceParam(
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
