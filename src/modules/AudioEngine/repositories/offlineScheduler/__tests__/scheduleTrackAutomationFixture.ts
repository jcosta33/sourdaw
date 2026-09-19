import { isDeviceParameterAutomatable } from '#/modules/Arrangement/useCases';
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
 * A device entry on the fixture's input surface: the scheduler's own entry,
 * with `contributesAudio` optional.
 *
 * The field describes the strip an entry came from, not the entry's device, so
 * a legacy case that never thinks about reachability must not have to state it
 * — the fixture supplies the printing strip those cases were written against.
 * A case about the refusal guard states its own value and overrides it.
 */
type FixtureDeviceEntry = Omit<ScheduleTrackAutomationInput['deviceEntries'][number], 'contributesAudio'> & {
    contributesAudio?: boolean;
};

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
function legacyFixtureDeviceLaw(deviceEntries: ReadonlyArray<FixtureDeviceEntry>): OfflineDeviceAutomationLaw {
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
 * The production law's *admission* half, for the cases that need it.
 *
 * Live admits a lane on the descriptor's `automatable` flag and asks whether
 * this render can carry it as a separate, second question; the fixture law
 * above instead admits only what already resolves an offline binding. That
 * difference is invisible for every parameter but one, and the one is #4424's
 * subject: the limiter ceiling is declared automatable yet resolves no binding,
 * so under the fixture law it is rejected at admission and the refusal under
 * test never runs. A case about that refusal states this law instead.
 *
 * Not the default for the older fixtures on purpose — see the fixture law's
 * comment: a real descriptor law admits every parameter a device declares, and
 * several of those cases were written against the narrower binding-only
 * admission.
 */
export function descriptorFixtureDeviceLaw(): OfflineDeviceAutomationLaw {
    return {
        acceptsAutomation: ({ deviceType, parameterId }) =>
            isDeviceParameterAutomatable({ deviceType, paramId: parameterId }),
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

export type ScheduleTrackAutomationFixtureInput = Omit<
    ScheduleTrackAutomationInput,
    'slewTickSeconds' | 'deviceParameterLaw' | 'resolveLaneCeiling' | 'deviceEntries'
> &
    Partial<Pick<ScheduleTrackAutomationInput, 'slewTickSeconds' | 'deviceParameterLaw' | 'resolveLaneCeiling'>> & {
        deviceEntries: ReadonlyArray<FixtureDeviceEntry>;
    };

/** `scheduleTrackAutomation` with the three render-context inputs defaulted. */
export function scheduleTrackAutomationFixture(input: ScheduleTrackAutomationFixtureInput): void {
    const { deviceEntries, ...rest } = input;
    scheduleTrackAutomation({
        slewTickSeconds: SHIPPING_GRAIN_SLEW_TICK_SECONDS,
        deviceParameterLaw: legacyFixtureDeviceLaw(deviceEntries),
        resolveLaneCeiling: declaredCeiling,
        ...rest,
        // `contributesAudio` first, so an entry that states its own value wins.
        deviceEntries: deviceEntries.map((entry) => ({ contributesAudio: true, ...entry })),
    });
}
