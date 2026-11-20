import { logger } from '#/infra/logger/appLogger';
import { captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { GLUTEN_PRESET_PARAMETER_ORDER } from '../models/GlutenPresetParameterOrder';

import { getGlutenFactoryPreset } from './getGlutenFactoryPreset';
import { encodeGlutenPresetParameters } from './glutenParamBridge/encodeGlutenPresetParameters';
import { syncGlutenPresetRuntime } from './glutenParamBridge/syncGlutenPresetRuntime';
import { readGlutenFactoryPresetTarget } from './readGlutenFactoryPresetTarget';

export async function selectGlutenFactoryPreset(deviceId: string, presetId: string): Promise<void> {
    const preset = getGlutenFactoryPreset(presetId);
    if (!preset) {
        return;
    }
    const owner = readGlutenFactoryPresetTarget(deviceId);
    if (!owner) {
        notifyUser('Could not load the preset. The Gluten device is no longer editable.', 'warning');
        return;
    }
    const after = encodeGlutenPresetParameters(preset.patch);
    const authority = captureDevicePatchCommitValidation({
        trackId: owner.trackId,
        deviceId,
        parameterIds: GLUTEN_PRESET_PARAMETER_ORDER,
        requireCurrentProjection: true,
    });
    if (!after || !authority) {
        notifyUser(`Could not load ${preset.name} on this Gluten device.`, 'warning');
        return;
    }
    const before = owner.state.parameterValues;
    const alreadyApplied = valuesEqual(before, after);
    let observedAdmission = false;
    try {
        await executeUserAppAction(
            {
                type: 'setGlutenFactoryPreset',
                payload: {
                    deviceId,
                    trackId: owner.trackId,
                    deviceIds: owner.deviceIds,
                    presetId,
                    before,
                    after,
                },
            },
            {
                shouldExecute: authority.isCurrent,
                shouldCommit: authority.isCurrent,
                skipMacroRecording: true,
                observeMaterializedAction: () => {
                    observedAdmission = true;
                },
            }
        );
        if (alreadyApplied && observedAdmission && authority.isCurrent()) {
            // Command drops equal project writes. The explicit pick still selects and reasserts the sound.
            syncGlutenPresetRuntime(owner.trackId, deviceId, after, preset.name);
        }
    } catch (error) {
        logger.error(new Error('Gluten factory preset selection failed', { cause: error }));
        if (isAppActionCommittedError(error)) {
            notifyUser(`${preset.name} was saved, but Gluten could not finish applying it.`, 'warning');
            return;
        }
        notifyUser(`Could not load ${preset.name}.`, 'error');
    }
}
