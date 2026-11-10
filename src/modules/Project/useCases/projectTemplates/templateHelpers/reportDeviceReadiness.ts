import { notifyUser } from '#/utils/Notification/notifyUser';

import { committedProject } from '../../projectPersistence/helpers/committedProjectAuthority';

import type { waitForDevices } from '#/modules/AudioEngine/useCases';

export function reportDeviceReadiness(
    result: Awaited<ReturnType<typeof waitForDevices>>,
    committedGeneration: number
): void {
    // Key on the committed project, not on transition bookkeeping: a
    // replacement that prepares, activates, or aborts before its authority
    // switch leaves the same project and graph open, so the template's cohort
    // must still warn. Only a replacement that actually replaced the document
    // moves the generation and makes this cohort stale.
    if (result.status !== 'failed' || committedGeneration !== committedProject.generation) {
        return;
    }
    const failedDevices = result.devices.filter((device) => device.status === 'failed');
    notifyUser(
        `Could not load ${failedDevices.map((device) => device.deviceId).join(', ')}. ` +
            'The project is open; reload it to retry the unavailable instruments or devices.',
        'warning'
    );
}
