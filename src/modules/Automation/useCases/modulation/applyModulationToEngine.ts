import { trackStore } from '#/modules/Arrangement/stores';
import { getPluginById } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { computeModulatorValue } from './computeModulatorValue';

type MappingBinding = {
    baseValue: number;
    paramMin: number;
    paramMax: number;
};

function resolveBinding(mapping: ModulatorMapping): MappingBinding | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }
    const track = tracks.find((t) => t.id === mapping.targetTrackId);
    if (!track) {
        return null;
    }
    const device = track.devices.find((d) => d.id === mapping.targetDeviceId);
    if (!device) {
        return null;
    }
    const descriptor = getPluginById(device.type);
    const paramDef = descriptor?.parameters.find((p) => p.id === mapping.targetParamId);
    if (!paramDef) {
        return null;
    }
    return {
        baseValue: device.parameterValues[mapping.targetParamId] ?? paramDef.defaultValue,
        paramMin: paramDef.minValue,
        paramMax: paramDef.maxValue,
    };
}

function clamp(value: number, min: number, max: number): number {
    if (value < min) {
        return min;
    }
    if (value > max) {
        return max;
    }
    return value;
}

/**
 * Writes the current modulated value for every active mapping to the audio
 * engine. The persisted base in `trackStore` is never touched — modulation is
 * purely an engine-side override. Intended to be called once per scheduler
 * tick; combine with `applyModulation` so the visual halo and the engine see
 * consistent values.
 */
export function applyModulationToEngine(currentBeat: number): void {
    const state = modulationStore.value;
    if (!state || state.modulators.length === 0) {
        return;
    }

    for (const modulator of state.modulators) {
        if (!modulator.enabled || modulator.mappings.length === 0) {
            continue;
        }
        const modValue = computeModulatorValue(modulator, currentBeat);

        for (const mapping of modulator.mappings) {
            const binding = resolveBinding(mapping);
            if (!binding) {
                continue;
            }

            const paramRange = binding.paramMax - binding.paramMin;
            const delta = modValue * mapping.amount * paramRange;
            const engineValue = clamp(binding.baseValue + delta, binding.paramMin, binding.paramMax);

            updateDeviceParam(mapping.targetTrackId, mapping.targetDeviceId, mapping.targetParamId, engineValue);
        }
    }
}
