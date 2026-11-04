import { logger } from '#/infra/logger/appLogger';

import { reportDeviceReadiness } from './reportDeviceReadiness';

import type { waitForDevices } from '#/modules/AudioEngine/useCases';

type DeviceReadiness = Awaited<ReturnType<typeof waitForDevices>>;

/**
 * Report a template cohort's readiness once it settles, without holding the
 * template's app action — and with it the launch overlay — for content work
 * that continues behind the workspace. The committed-project rule in
 * `reportDeviceReadiness` still suppresses a cohort from a project the user has
 * left, and a device that failed still reaches the user once the cohort settles.
 */
export function reportDeviceReadinessWhenSettled(
    readiness: Promise<DeviceReadiness>,
    committedGeneration: number
): void {
    void readiness.then(
        (result) => reportDeviceReadiness(result, committedGeneration),
        (error: unknown) => logger.warn('[Project] Failed to observe device readiness for an opened template:', error)
    );
}
