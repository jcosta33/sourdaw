import { clampDeviceParamWrite } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../repositories/createWebAudioEngine';

import { withDeviceParameterRuntimeWriteOwner } from './withDeviceParameterRuntimeWriteOwner';

type WriteWebDeviceParamInput = {
    trackId: string;
    deviceId: string;
    paramId: string;
    value: number;
};

/** Clamp the project value and scope the Web Audio write to its parameter owner. */
export function writeWebDeviceParam(
    { trackId, deviceId, paramId, value }: WriteWebDeviceParamInput,
    runtimeOwner?: symbol
): number {
    const clamped = clampDeviceParamWrite({ deviceId, paramId, value });
    withDeviceParameterRuntimeWriteOwner(trackId, deviceId, paramId, runtimeOwner, () => {
        audioEngine.updateDeviceParam(trackId, deviceId, paramId, clamped);
    });
    return clamped;
}
