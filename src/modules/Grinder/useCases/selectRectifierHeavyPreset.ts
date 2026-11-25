import { logger } from '#/infra/logger/appLogger';
import { captureDevicePatchCommitValidation } from '#/modules/Arrangement/useCases';
import { executeUserAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { type GrinderFactoryPresetAction } from '../events/grinderAppActions';
import { grinderFactoryPresetRuntimePort } from './grinderFactoryPresetRuntimePort';

import { captureRectifierHeavyPreset } from './grinderParamBridge/captureRectifierHeavyPreset';

export async function selectRectifierHeavyPreset(deviceId: string): Promise<void> {
    const captured = captureRectifierHeavyPreset(deviceId);
    if (!captured) {
        notifyUser('Could not load Rectifier Heavy. The Grinder device is no longer editable.', 'warning');
        return;
    }
    const authority = captureDevicePatchCommitValidation({
        trackId: captured.trackId,
        deviceId,
        parameterIds: captured.parameterIds,
        requireCurrentProjection: true,
    });
    if (!authority) {
        notifyUser('Could not load Rectifier Heavy on this Grinder device.', 'warning');
        return;
    }
    const action: GrinderFactoryPresetAction = {
        type: 'setGrinderFactoryPreset',
        payload: {
            trackId: captured.trackId,
            deviceId,
            deviceIds: captured.deviceIds,
            presetId: 'gr-rectifier-heavy',
            before: captured.before.parameterValues,
            after: captured.after.parameterValues,
        },
    };
    let observed = false;
    try {
        await executeUserAppAction(action, {
            shouldExecute: authority.isCurrent,
            shouldCommit: authority.isCurrent,
            skipMacroRecording: true,
            observeMaterializedAction: () => {
                observed = true;
            },
        });
        if (observed && valuesEqual(action.payload.before, action.payload.after) && authority.isCurrent()) {
            grinderFactoryPresetRuntimePort.publish(action.payload);
        }
    } catch (error) {
        logger.error(new Error('Grinder factory preset selection failed', { cause: error }));
        if (isAppActionCommittedError(error)) {
            notifyUser('Rectifier Heavy was saved, but Grinder could not finish applying it.', 'warning');
            return;
        }
        notifyUser('Could not load Rectifier Heavy.', 'error');
    }
}
