import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectLoadEpoch } from '../../projectPersistence/helpers/runProjectLoadTransaction';

import type { waitForDevices } from '#/modules/AudioEngine/useCases';

export function reportDeviceReadiness(
    result: Awaited<ReturnType<typeof waitForDevices>>,
    originatingEpoch: number
): void {
    // Judge the cohort against the project the user is actually in, not the
    // latest prepared transition: a replacement that prepares and then aborts
    // without activating leaves the template active while `isCurrent` would
    // read the still-open project's cohort as superseded and drop its warning.
    if (result.status !== 'failed' || (originatingEpoch > 0 && originatingEpoch !== projectLoadEpoch.active)) {
        return;
    }
    const failedDevices = result.devices.filter((device) => device.status === 'failed');
    notifyUser(
        `Could not load ${failedDevices.map((device) => device.deviceId).join(', ')}. ` +
            'The project is open; reload it to retry the unavailable instruments or devices.',
        'warning'
    );
}
