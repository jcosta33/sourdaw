import { logger } from '#/infra/logger/appLogger';
import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { captureDevicePatchCommitValidation, getPlannedDevicePatchState } from '#/modules/Arrangement/useCases';
import { executeAppActionBatch } from '#/modules/Command/useCases';
import { jsonValuesEqual } from '#/utils/jsonSemanticEquality';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { toToasterKitState } from '../models/ToasterKitState';

import { getToasterPresetKit } from './getToasterPresetKit';

export async function selectToasterFactoryKit(deviceId: string, presetId: string): Promise<void> {
    const kit = getToasterPresetKit(presetId);
    if (!kit) {
        return;
    }
    const owner = resolveEligibleDeviceWriteTarget(deviceId);
    const current =
        owner.status === 'eligible'
            ? getPlannedDevicePatchState({ deviceId, trackId: owner.trackId, parameterIds: [] })
            : null;
    if (current?.deviceType !== DEVICE_TYPE_IDS.toaster || current.frozen) {
        notifyUser('Could not load the kit. The Toaster track is frozen or no longer available.', 'warning');
        return;
    }
    const { trackId, deviceIds } = current;
    const before = current.state.deviceState;
    const replacement = toToasterKitState(kit);
    const after = { ...replacement, data: { ...before?.data, ...replacement.data } };
    if (jsonValuesEqual(before, after)) {
        return;
    }
    const authority = captureDevicePatchCommitValidation({
        trackId,
        deviceId,
        parameterIds: [],
        requireCurrentProjection: true,
    });
    if (!authority) {
        notifyUser('Could not load the kit while the project is changing.', 'warning');
        return;
    }
    const label = `Load ${kit.name}`;
    try {
        const result = await executeAppActionBatch(
            [
                {
                    type: 'setToasterFactoryKit',
                    payload: { deviceId, trackId, deviceIds: [...deviceIds], label, before, after },
                },
            ],
            {
                groupId: crypto.randomUUID(),
                groupLabel: label,
                source: 'manual',
                skipMacroRecording: true,
                shouldExecute: authority.isCurrent,
            }
        );
        if ('reason' in result) {
            notifyUser(`Could not load ${kit.name}. ${result.reason}`, 'warning');
        }
    } catch (error) {
        logger.error(new Error('Toaster factory kit selection failed', { cause: error }));
        notifyUser(`Could not load ${kit.name}.`, 'error');
    }
}
