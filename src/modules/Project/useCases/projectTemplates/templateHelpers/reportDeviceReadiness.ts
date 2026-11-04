import { logger } from '#/infra/logger/appLogger';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { projectLoadEpoch } from '../../projectPersistence/helpers/runProjectLoadTransaction';

import type { waitForDevices } from '#/modules/AudioEngine/useCases';

type DeviceReadiness = Awaited<ReturnType<typeof waitForDevices>>;

export function reportDeviceReadiness(result: DeviceReadiness, originatingEpoch: number): void {
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

/**
 * Report a template cohort's readiness once it settles, without holding the
 * template's app action — and with it the launch overlay — for content work
 * that continues behind the workspace. The epoch guard in
 * `reportDeviceReadiness` still suppresses an obsolete cohort, and a device
 * that failed still reaches the user once the cohort settles.
 */
export function reportDeviceReadinessWhenSettled(readiness: Promise<DeviceReadiness>, originatingEpoch: number): void {
    void readiness.then(
        (result) => reportDeviceReadiness(result, originatingEpoch),
        (error: unknown) => logger.warn('[Project] Failed to observe device readiness for an opened template:', error)
    );
}
