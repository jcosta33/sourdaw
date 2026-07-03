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
    return {
        baseValue: device.parameterValues[mapping.targetParamId] ?? paramDef.defaultValue,
        paramMin: paramDef.min,
        paramMax: paramDef.max,
        deviceType: device.type,
    };
}
