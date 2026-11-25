import { logger } from '#/infra/logger/appLogger';
import { captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { CRUST_PRESET_PARAMETER_ORDER } from '../models/CrustPresetParameterOrder';

import { encodeCrustPresetParameters } from './crustParamBridge/encodeCrustPresetParameters';
import { syncCrustPresetRuntime } from './crustParamBridge/syncCrustPresetRuntime';
import { getCrustFactoryPreset } from './crustPresets';
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
    const { trackId, trackObjectId, deviceObjectId, deviceIds, state } = owner;
    const { isCurrent } = authority;
    const before = state.parameterValues;
    const alreadyApplied = valuesEqual(before, after);
    function matchesCurrentSelection(): boolean {
        if (!isCurrent()) {
            return false;
        }
        const current = readCrustFactoryPresetTarget(deviceId);
        return (
            current?.trackObjectId === trackObjectId &&
            current.deviceObjectId === deviceObjectId &&
            valuesEqual(current.deviceIds, deviceIds) &&
            valuesEqual(current.state, state)
        );
    }
    const admission: { observed: boolean } = { observed: false };
    try {
        await executeUserAppAction(
            {
                type: 'setCrustFactoryPreset',
                payload: {
                    deviceId,
                    trackId,
                    trackObjectId,
                    deviceObjectId,
                    deviceIds,
                    presetId,
                    before,
                    after,
                },
            },
            {
                shouldExecute: isCurrent,
                shouldCommit: isCurrent,
                skipMacroRecording: true,
                observeMaterializedAction: () => {
                    admission.observed = true;
                },
            }
        );
        if (alreadyApplied && admission.observed) {
            // Command drops equal project writes. The explicit pick still selects and reasserts the sound.
            syncCrustPresetRuntime({
                trackId,
                deviceId,
                parameters: after,
                metadata: preset.patch,
                isCurrent: matchesCurrentSelection,
            });
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
