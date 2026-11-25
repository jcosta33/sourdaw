import { logger } from '#/infra/logger/appLogger';
import { captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { CRUST_PRESET_PARAMETER_ORDER } from '../models/CrustPresetParameterOrder';

import { getCrustFactoryPreset } from './crustPresets';
import { encodeCrustPresetParameters } from './crustParamBridge/encodeCrustPresetParameters';
import { syncCrustPresetRuntime } from './crustParamBridge/syncCrustPresetRuntime';
import { readCrustFactoryPresetTarget } from './readCrustFactoryPresetTarget';

export async function selectCrustFactoryPreset(deviceId: string, presetId: string): Promise<void> {
    const preset = getCrustFactoryPreset(presetId);
    if (!preset) {
        return;
    }
    const owner = readCrustFactoryPresetTarget(deviceId);
    if (!owner) {
        notifyUser('Could not load the preset. The Crust device is no longer editable.', 'warning');
        return;
    }
    const after = encodeCrustPresetParameters(preset.patch);
    const authority = captureDevicePatchCommitValidation({
        trackId: owner.trackId,
        deviceId,
        parameterIds: CRUST_PRESET_PARAMETER_ORDER,
        requireCurrentProjection: true,
    });
    if (!after || !authority) {
        notifyUser(`Could not load ${preset.name} on this Crust device.`, 'warning');
        return;
    }
    const before = owner.state.parameterValues;
    const alreadyApplied = valuesEqual(before, after);
    const matchesCurrentSelection = (): boolean => {
        if (!authority.isCurrent()) {
            return false;
        }
        const current = readCrustFactoryPresetTarget(deviceId);
        return (
            current?.trackObjectId === owner.trackObjectId &&
            current.deviceObjectId === owner.deviceObjectId &&
            valuesEqual(current.deviceIds, owner.deviceIds) &&
            valuesEqual(current.state, owner.state)
        );
    };
    const admission: { observed: boolean } = { observed: false };
    try {
        await executeUserAppAction(
            {
                type: 'setCrustFactoryPreset',
                payload: {
                    deviceId,
                    trackId: owner.trackId,
                    trackObjectId: owner.trackObjectId,
                    deviceObjectId: owner.deviceObjectId,
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
                    admission.observed = true;
                },
            }
        );
        if (alreadyApplied && admission.observed) {
            // Command drops equal project writes. The explicit pick still selects and reasserts the sound.
            syncCrustPresetRuntime(owner.trackId, deviceId, after, preset.patch, matchesCurrentSelection);
        }
    } catch (error) {
        logger.error(new Error('Crust factory preset selection failed', { cause: error }));
        if (isAppActionCommittedError(error)) {
            notifyUser(`${preset.name} was saved, but Crust could not finish applying it.`, 'warning');
            return;
        }
        notifyUser(`Could not load ${preset.name}.`, 'error');
    }
}
