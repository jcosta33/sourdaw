import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { DEFAULT_PATCH, FILTER_MODEL_NAMES, FILTER_MODE_NAMES } from '../models/FermenterPatch';
import { setFermenterParam } from '../stores/fermenterStore';

import { cancelPendingFermenterParam } from './fermenterParamBridge/cancelPendingFermenterParam';

type FilterChoice = 'filterModel' | 'filterMode';

const pendingChoices = new Map<string, { superseded: boolean }>();

export async function selectFermenterFilterChoice(
    deviceId: string,
    paramId: FilterChoice,
    value: number
): Promise<void> {
    const choices = paramId === 'filterModel' ? FILTER_MODEL_NAMES : FILTER_MODE_NAMES;
    if (!Number.isInteger(value) || value < 0 || value >= choices.length) {
        return;
    }
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }
    const owner = trackStore.value?.tracks.find((track) => track.id === target.trackId);
    const device = owner?.devices.find((candidate) => candidate.id === deviceId);
    if (!owner || device?.type !== 'fermenter') {
        return;
    }
    // A pending continuous bridge write must not overtake this discrete command.
    cancelPendingFermenterParam(deviceId, paramId);
    const choiceKey = `${deviceId}:${paramId}`;
    const valuePresent = Object.hasOwn(device.parameterValues, paramId);
    const previousValue = device.parameterValues[paramId];
    setFermenterParam(deviceId, paramId, previousValue ?? DEFAULT_PATCH[paramId]);
    const olderChoice = pendingChoices.get(choiceKey);
    if (olderChoice) {
        olderChoice.superseded = true;
    }
    if ((previousValue ?? DEFAULT_PATCH[paramId]) === value) {
        return;
    }

    // A queued choice must not retarget a replacement that reuses every visible ID.
    const authority = captureProjectTransitionAuthority();
    const revision = captureProjectRevision();
    const pendingChoice = { superseded: false };
    pendingChoices.set(choiceKey, pendingChoice);
    try {
        await executeUserAppAction(
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId,
                    paramId,
                    value,
                    expectedTrackId: owner.id,
                    expectedDeviceType: device.type,
                    expectedDeviceIds: owner.devices.map((candidate) => candidate.id),
                    expectedValuePresent: valuePresent,
                    expectedValue: valuePresent ? previousValue : undefined,
                    expectedTrackFrozen: owner.frozen,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            {
                shouldExecute: () =>
                    !pendingChoice.superseded && authority.isCurrent() && captureProjectRevision() === revision,
            }
        );
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Fermenter Filter change failed', 'error');
    } finally {
        if (pendingChoices.get(choiceKey) === pendingChoice) {
            pendingChoices.delete(choiceKey);
        }
    }
}
