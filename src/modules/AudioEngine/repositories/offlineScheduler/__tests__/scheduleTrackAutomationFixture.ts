import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { type AutomationLane } from '../../../models/AutomationViewTypes';
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
 * law arrived ("this strategy can be automated offline"), an identity clamp and
 * an identity quantiser. That preserves exactly what each of them was written to
 * assert: none of them rides a parameter the registry declares stepped, so a
 * real quantiser would round nothing and only obscure which law is under test.
 *
 * The production law is driven from its real caller in
 * `useCases/offlineRender/__tests__/scheduleTrackClips.spec.ts` ("offline
 * automation reads the same laws live does"); do not read a green run here as
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
        quantiseValue: ({ value }) => value,
    };
}

/**
 * The lane-ceiling law these older fixtures were written against: the scalar the
 * lane stores, with no widening.
 *
 * Production hands `scheduleTrackAutomation` Automation's
 * `getAutomationLaneCeiling`, which reads a legacy track gain lane's stored
 * `maxValue: 1` as the fader's real `+6 dB` ceiling. None of the fixtures using
 * this helper is about that widening — they ride pan, sends, device parameters
 * and slew grain — so they keep the plain declared range, which is what the live
 * `clampToLaneRange` also reduces to for every lane the widening does not touch.
 *
 * The production law is driven from its real caller in
 * `useCases/offlineRender/__tests__/legacyGainLaneRenderParity.spec.ts`; do not
 * read a green run here as evidence about it.
 */
function declaredCeiling(lane: Pick<AutomationLane, 'maxValue'>): number {
    return lane.maxValue;
}

type ScheduleTrackAutomationFixtureInput = Omit<
    ScheduleTrackAutomationInput,
    'slewTickSeconds' | 'deviceParameterLaw' | 'resolveLaneCeiling'
> &
    Partial<Pick<ScheduleTrackAutomationInput, 'slewTickSeconds' | 'deviceParameterLaw' | 'resolveLaneCeiling'>>;

/** `scheduleTrackAutomation` with the three render-context inputs defaulted. */
export function scheduleTrackAutomationFixture(input: ScheduleTrackAutomationFixtureInput): void {
    scheduleTrackAutomation({
        slewTickSeconds: SHIPPING_GRAIN_SLEW_TICK_SECONDS,
        deviceParameterLaw: legacyFixtureDeviceLaw(input.deviceEntries),
        resolveLaneCeiling: declaredCeiling,
        ...input,
    });
}
