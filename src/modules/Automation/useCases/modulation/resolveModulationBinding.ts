import { trackStore } from '#/modules/Arrangement/stores';

import { type ModulatorMapping } from '../../models/Modulator';

import { getModulationDependencies } from './getModulationDependencies';

type ResolveModulationBindingOutput = {
    baseValue: number;
    paramMin: number;
    paramMax: number;
    deviceType: string;
} | null;

export function resolveModulationBinding(mapping: ModulatorMapping): ResolveModulationBindingOutput {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }
    const track = tracks.find((candidate) => candidate.id === mapping.targetTrackId);
    if (!track) {
        return null;
    }
    const device = track.devices.find((candidate) => candidate.id === mapping.targetDeviceId);
    if (!device) {
        return null;
    }
    const paramDef = getModulationDependencies().getPluginParamRange(device.type, mapping.targetParamId);
    if (!paramDef) {
        return null;
    }
    // A stored mapping is one of the routes that reaches a parameter without
    // ever passing the picker, so the declared flag has to be read here too.
    // Refusing the binding leaves the parameter wherever the user last put it,
    // which is what "not automatable" is supposed to mean.
    if (!paramDef.automatable) {
        return null;
    }
    return {
        baseValue: device.parameterValues[mapping.targetParamId] ?? paramDef.defaultValue,
        paramMin: paramDef.min,
        paramMax: paramDef.max,
        deviceType: device.type,
    };
}
