import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAudioTime } from '#/modules/AudioEngine/useCases/engineAccess/getAudioTime';

import { type Step, type ToasterKit, createDefaultKit } from '../../models/ToasterKit';
import { toasterStore, defaultToasterState } from '../../stores/toasterStore';
import { startSequencer } from '../startSequencer';
import { stopSequencer } from '../stopSequencer';
import { setPadEngineImmediate } from '../toasterParamBridge/setPadEngineImmediate';
import { triggerToasterPad } from '../triggerPad';

vi.mock('#/modules/AudioEngine/useCases/engineAccess/getAudioTime', () => ({
    getAudioTime: vi.fn(() => 0),
}));

vi.mock('../triggerPad', () => ({
    triggerToasterPad: vi.fn(),
}));

vi.mock('../toasterParamBridge/setPadEngineImmediate', () => ({
    setPadEngineImmediate: vi.fn(),
}));

vi.mock('../toasterParamBridge/setToasterPadParam', () => ({
    setToasterPadParam: vi.fn(),
}));

const DEVICE = 'seq-device';
const OTHER = 'other-device';

function activeStep(overrides: Partial<Step> = {}): Step {
    return {
        active: true,
        velocity: 1,
        probability: 1,
        microTiming: 0,
        retriggerCount: 0,
        condition: 'always',
        paramLocks: {},
        ...overrides,
    };
}

function kitWithStep(step: Step): ToasterKit {
    const kit = createDefaultKit();
    // Single-step pattern on pad 0 so the first tick fires deterministically.
    kit.patterns = [
        {
            id: 'A1',
            name: 'A1',
            stepsPerBar: 1,
            bars: 1,
            tracks: [{ padIndex: 0, steps: [step] }],
        },
    ];
    kit.activePatternId = 'A1';
    return kit;
}

function seedDevice(deviceId: string, step: Step): void {
    toasterStore.set({
        ...toasterStore.value,
        [deviceId]: { ...defaultToasterState, kit: kitWithStep(step) },
    });
}

describe('startSequencer', () => {
    beforeEach(() => {
        Container.clear();
        vi.useFakeTimers();
        vi.mocked(getAudioTime).mockReturnValue(0);
        vi.clearAllMocks();
        toasterStore.set({});
    });

    afterEach(() => {
        stopSequencer(DEVICE);
        stopSequencer(OTHER);
        vi.useRealTimers();
        toasterStore.set({});
    });

    it('reads the audio clock when starting', () => {
        seedDevice(DEVICE, activeStep({ active: false }));
        startSequencer(DEVICE, 120, 4);
        stopSequencer(DEVICE);

        expect(getAudioTime).toHaveBeenCalled();
    });

    // Regression — tick must trigger and route locks to ITS OWN deviceId, not
    // the first toaster device. Previously triggers used the sequencer's id but
    // sound/param locks were routed to getFirstToasterDeviceId(), so instance B
    // drove instance A's worklet.
    it('routes the sound-lock engine swap to its own deviceId', () => {
        seedDevice(OTHER, activeStep({ active: false })); // a "first" device that must not be touched
        seedDevice(DEVICE, activeStep({ soundLock: 'snare-808' }));

        startSequencer(DEVICE, 120, 4);

        // Trigger fired on the sequencer's own device.
        expect(triggerToasterPad).toHaveBeenCalledWith(DEVICE, 0, 127);
        // Engine swap routed to the same device — never to OTHER.
        for (const call of vi.mocked(setPadEngineImmediate).mock.calls) {
            expect(call[0]).toBe(DEVICE);
        }
        expect(vi.mocked(setPadEngineImmediate).mock.calls.length).toBeGreaterThan(0);
    });

    // Regression (Fix #4) — for a delayed (microtiming) sound-locked step the
    // engine swap must ride inside the deferred fire, not mutate the shared slot
    // before the delay. So no swap happens until the delay elapses.
    it('defers the sound-lock engine swap until the microtiming fire', () => {
        seedDevice(DEVICE, activeStep({ soundLock: 'snare-808', microTiming: 0.4 }));

        startSequencer(DEVICE, 120, 4);

        // Before the microtiming delay: no engine swap and no trigger yet.
        expect(setPadEngineImmediate).not.toHaveBeenCalled();
        expect(triggerToasterPad).not.toHaveBeenCalled();

        vi.advanceTimersByTime(200); // elapse the microtiming offset

        // Now the swap-trigger-revert sequence has run.
        expect(triggerToasterPad).toHaveBeenCalledWith(DEVICE, 0, 127);
        expect(setPadEngineImmediate).toHaveBeenCalled();
    });

    // Regression (Fix #2) — microtiming/retrigger fires scheduled by a tick must
    // be cancelled by stopSequencer; otherwise ghost hits land after Stop.
    it('cancels pending microtiming fires on stop (no ghost hits)', () => {
        seedDevice(DEVICE, activeStep({ microTiming: 0.4, retriggerCount: 3 }));

        startSequencer(DEVICE, 120, 4);
        expect(triggerToasterPad).not.toHaveBeenCalled(); // all deferred

        stopSequencer(DEVICE);
        vi.advanceTimersByTime(5000); // would have fired the ghost hits

        expect(triggerToasterPad).not.toHaveBeenCalled();
    });
});
