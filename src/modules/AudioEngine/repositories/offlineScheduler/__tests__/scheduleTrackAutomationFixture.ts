import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import {
    scheduleTrackAutomation,
    type OfflineDeviceAutomationLaw,
    type ScheduleTrackAutomationInput,
} from '../automationScheduling';

/**
 * The shipping scheduler grain, resolved through the same conversion production
 * uses rather than restating `0.01`. A spec that cares about the grain passes
 * its own `slewTickSeconds`.
 */
export const SHIPPING_GRAIN_SLEW_TICK_SECONDS = automationSlewTickSecondsForGrain(10);

/**
 * The law these older fixtures were written against.
 *
 * Production hands `scheduleTrackAutomation` Arrangement's `DeviceParameterLaw`
 * — `parameterValues` presence plus the descriptor's `automatable` flag, and the
 * declared-range clamp — which is the whole point of the parameter. The fixtures
 * that use this helper carry no `parameterValues` and no descriptor-bearing
 * device instances, so they keep the predicate the offline path used before the
 * law arrived ("this strategy can be automated offline") and an identity clamp.
 * That preserves exactly what each of them was written to assert.
 *
 * The production law is driven end-to-end by
 * `liveOfflineAutomationLawParity.spec.ts`; do not read a green run here as
 * evidence about it.
 */
function legacyFixtureDeviceLaw(
    deviceEntries: ScheduleTrackAutomationInput['deviceEntries']
): OfflineDeviceAutomationLaw {
    return {
        acceptsAutomation: ({ deviceId, parameterId }) => {
            const entry = deviceEntries.find((candidate) => candidate.deviceId === deviceId);
            if (!entry) {
                return false;
            }
            return entry.strategy.resolveOfflineAutomation(parameterId) !== null;
        },
        clampValue: ({ value }) => value,
    };
}

type ScheduleTrackAutomationFixtureInput = Omit<
    ScheduleTrackAutomationInput,
    'slewTickSeconds' | 'deviceParameterLaw'
> &
    Partial<Pick<ScheduleTrackAutomationInput, 'slewTickSeconds' | 'deviceParameterLaw'>>;

/** `scheduleTrackAutomation` with the two render-context inputs defaulted. */
export function scheduleTrackAutomationFixture(input: ScheduleTrackAutomationFixtureInput): void {
    scheduleTrackAutomation({
        slewTickSeconds: SHIPPING_GRAIN_SLEW_TICK_SECONDS,
        deviceParameterLaw: legacyFixtureDeviceLaw(input.deviceEntries),
        ...input,
    });
}
