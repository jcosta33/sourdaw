import { notifyUser } from '#/utils/Notification/notifyUser';

import type { waitForDevices } from '#/modules/AudioEngine/useCases';

export function reportDeviceReadiness(result: Awaited<ReturnType<typeof waitForDevices>>): void {
    if (result.status !== 'failed') {
        return;
    }
    const failedDevices = result.devices.filter((device) => device.status === 'failed');
    notifyUser(
        `Could not load ${failedDevices.map((device) => device.deviceId).join(', ')}. ` +
            'The project is open; reload it to retry the unavailable instruments or devices.',
        'warning'
    );
}
