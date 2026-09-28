import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectLoadEpoch } from '../../projectPersistence/helpers/runProjectLoadTransaction';

import type { waitForDevices } from '#/modules/AudioEngine/useCases';

export function reportDeviceReadiness(
    result: Awaited<ReturnType<typeof waitForDevices>>,
    originatingEpoch: number
): void {
    if (result.status !== 'failed' || (originatingEpoch > 0 && !projectLoadEpoch.isCurrent(originatingEpoch))) {
        return;
    }
    const failedDevices = result.devices.filter((device) => device.status === 'failed');
    notifyUser(
        `Could not load ${failedDevices.map((device) => device.deviceId).join(', ')}. ` +
            'The project is open; reload it to retry the unavailable instruments or devices.',
        'warning'
    );
}
