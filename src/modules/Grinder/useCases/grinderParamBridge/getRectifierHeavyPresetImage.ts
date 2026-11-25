import { clampDeviceParameterValue } from '#/modules/Arrangement/useCases';

import { migrateGrinderPatch } from '../../models/GrinderPatch';
import { GRINDER_PRESETS } from '../grinderPresets';

import { encodeGrinderPatchCommands } from './encodeGrinderPatchCommands';

export function getRectifierHeavyPresetImage() {
    const preset = GRINDER_PRESETS.find((candidate) => candidate.id === 'gr-rectifier-heavy');
    if (!preset) {
        return null;
    }
    const patch = migrateGrinderPatch(preset.patch);
    const parameterValues: Record<string, number> = {};
    for (const command of encodeGrinderPatchCommands(patch)) {
        if (command.kind !== 'parameter') {
            continue;
        }
        if (!Number.isFinite(command.value) || Object.hasOwn(parameterValues, command.key)) {
            return null;
        }
        parameterValues[command.key] = clampDeviceParameterValue({
            deviceType: 'grinder',
            paramId: command.key,
            value: command.value,
        });
    }
    return { patch, parameterValues };
}
