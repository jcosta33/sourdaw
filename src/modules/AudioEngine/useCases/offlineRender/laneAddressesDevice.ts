import { resolveDeviceAutomationTargetIndex } from '#/utils/automationDeviceTarget';

import { type AutomationLane } from '../../models/AutomationViewTypes';
import { type OfflineDeviceAutomationLaw } from '../../repositories/offlineScheduler/automationScheduling';

import { type StripAutomationDeviceEntry } from './projectStripAutomationWrites';

/**
 * Whether this lane addresses one of `entries` under the device law — the same
 * two-step resolution `scheduleTrackAutomation` and the tick path both run, so
 * a legacy bare lane cannot be judged here against a different device than the
 * one that will actually carry it.
 */
export function laneAddressesDevice(
    lane: AutomationLane,
    entries: readonly StripAutomationDeviceEntry[],
    law: OfflineDeviceAutomationLaw
): boolean {
    const index = resolveDeviceAutomationTargetIndex(lane.parameterId, entries, (candidate, parameterId) =>
        law.acceptsAutomation({
            deviceId: candidate.deviceId,
            deviceType: candidate.deviceType,
            parameterId,
        })
    );
    return index >= 0;
}
