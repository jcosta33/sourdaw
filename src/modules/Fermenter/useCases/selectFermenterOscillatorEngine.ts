import { resolveEligibleDeviceWriteTarget, trackStore } from '#/modules/Arrangement/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';
import { captureProjectTransitionAuthority } from '#/modules/Project/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { DEFAULT_PATCH, ENGINE_NAMES } from '../models/FermenterPatch';

export async function selectFermenterOscillatorEngine(deviceId: string, engine: number): Promise<void> {
    if (!Number.isInteger(engine) || engine < 0 || engine >= ENGINE_NAMES.length) {
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
    const valuePresent = Object.hasOwn(device.parameterValues, 'oscEngine');
    const previousValue = device.parameterValues.oscEngine;
    if ((previousValue ?? DEFAULT_PATCH.oscEngine) === engine) {
        return;
    }

    // A queued choice must not retarget a replacement that reuses every visible ID.
    const authority = captureProjectTransitionAuthority();
    const revision = captureProjectRevision();
    try {
        await executeUserAppAction(
            {
                type: 'setDeviceParameter',
                payload: {
                    deviceId,
                    paramId: 'oscEngine',
                    value: engine,
                    expectedTrackId: owner.id,
                    expectedDeviceType: device.type,
                    expectedDeviceIds: owner.devices.map((candidate) => candidate.id),
                    expectedValuePresent: valuePresent,
                    expectedValue: valuePresent ? previousValue : undefined,
                    expectedTrackFrozen: owner.frozen,
                    automationRecordingPolicy: 'suppressed',
                },
            },
            { shouldExecute: () => authority.isCurrent() && captureProjectRevision() === revision }
        );
    } catch (error) {
        notifyUser(error instanceof Error ? error.message : 'Fermenter Engine change failed', 'error');
    }
}
