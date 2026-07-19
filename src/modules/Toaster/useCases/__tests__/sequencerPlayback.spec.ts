import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAudioTime } from '#/modules/AudioEngine/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { type Step, type ToasterKit, createDefaultKit } from '../../models/ToasterKit';
import { toasterStore, defaultToasterState } from '../../stores/toasterStore';
import { startSequencer } from '../startSequencer';
import { stopSequencer } from '../stopSequencer';
import { setPadEngineImmediate } from '../toasterParamBridge/setPadEngineImmediate';
import { triggerToasterPad } from '../triggerPad';

vi.mock('#/modules/AudioEngine/useCases', () => ({
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
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
        transportStore.set({ ...defaultTransportState, tempo: 120 });
    });

    afterEach(() => {
        stopSequencer(DEVICE);
        stopSequencer(OTHER);
        vi.useRealTimers();
        toasterStore.set({});
        transportStore.set({ ...defaultTransportState });
    });

    it('reads the audio clock when starting', () => {
        seedDevice(DEVICE, activeStep({ active: false }));
        startSequencer(DEVICE, 120);
        stopSequencer(DEVICE);

        expect(getAudioTime).toHaveBeenCalled();
    });

    it('adapts the MIDI-owned pattern groove into live trigger timing and dynamics', () => {
        const kit = kitWithStep(activeStep());
        kit.patterns[0]!.stepsPerBar = 16;
        toasterStore.set({
            ...toasterStore.value,
            [DEVICE]: { ...defaultToasterState, kit },
        });
        createGrooveTemplate({
            id: 'live-pocket',
            name: 'Live pocket',
            subdivision: '1/16',
            slots: [{ index: 0, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:seq-device:A1',
            templateId: 'live-pocket',
            amount: 1,
        });

        startSequencer(DEVICE, 120);
        expect(triggerToasterPad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(25);
        expect(triggerToasterPad).toHaveBeenCalledWith(DEVICE, 0, 114);
    });

    it('pre-schedules a negative groove offset at the same early beat exported to the timeline', () => {
        vi.setSystemTime(0);
        vi.mocked(getAudioTime).mockImplementation(() => Date.now() / 1000);
        const kit = kitWithStep(activeStep({ active: false }));
        kit.patterns[0] = {
            ...kit.patterns[0]!,
            stepsPerBar: 16,
            tracks: [
                {
                    padIndex: 0,
                    steps: [
                        activeStep({ active: false }),
                        activeStep(),
                        ...Array.from({ length: 14 }, () => activeStep({ active: false })),
                    ],
                },
            ],
        };
        toasterStore.set({
            ...toasterStore.value,
            [DEVICE]: { ...defaultToasterState, kit },
        });
        createGrooveTemplate({
            id: 'live-early-pocket',
            name: 'Live early pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: -0.5, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'early-live-export-oracle' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:seq-device:A1',
            templateId: 'live-early-pocket',
            amount: 1,
        });

        startSequencer(DEVICE, 120);
        vi.advanceTimersByTime(61);
        expect(triggerToasterPad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2);

        expect(triggerToasterPad).toHaveBeenCalledWith(DEVICE, 0, 127);
    });

    it('derives 32-step cadence, groove grid, retriggers, and loop timing from the pattern', () => {
        vi.setSystemTime(0);
        vi.mocked(getAudioTime).mockImplementation(() => Date.now() / 1000);
        const kit = kitWithStep(activeStep({ active: false }));
        kit.patterns[0] = {
            ...kit.patterns[0]!,
            stepsPerBar: 32,
            tracks: [
                {
                    padIndex: 0,
                    steps: [
                        activeStep({ active: false }),
                        activeStep({ retriggerCount: 1 }),
                        ...Array.from({ length: 30 }, () => activeStep({ active: false })),
                    ],
                },
            ],
        };
        toasterStore.set({
            ...toasterStore.value,
            [DEVICE]: { ...defaultToasterState, kit },
        });
        createGrooveTemplate({
            id: 'live-thirty-second-pocket',
            name: 'Live thirty-second pocket',
            subdivision: '1/32',
            slots: [{ index: 1, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'test-32' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:seq-device:A1',
            templateId: 'live-thirty-second-pocket',
            amount: 1,
        });

        startSequencer(DEVICE, 120);
        vi.advanceTimersByTime(61);
        expect(triggerToasterPad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(15);
        expect(triggerToasterPad).toHaveBeenNthCalledWith(1, DEVICE, 0, 114);
        vi.advanceTimersByTime(31);
        expect(triggerToasterPad).toHaveBeenNthCalledWith(2, DEVICE, 0, 100);

        vi.advanceTimersByTime(1831);
        expect(toasterStore.value?.[DEVICE]?.currentStep).toBe(31);
        vi.advanceTimersByTime(62);
        expect(toasterStore.value?.[DEVICE]?.currentStep).toBe(0);
    });

    it('uses the current transport tempo for each scheduling window', () => {
        vi.setSystemTime(0);
        vi.mocked(getAudioTime).mockImplementation(() => Date.now() / 1000);
        const kit = kitWithStep(activeStep({ active: false }));
        kit.patterns[0] = {
            ...kit.patterns[0]!,
            stepsPerBar: 4,
            tracks: [
                {
                    padIndex: 0,
                    steps: [
                        activeStep({ active: false }),
                        activeStep(),
                        activeStep({ active: false }),
                        activeStep({ active: false }),
                    ],
                },
            ],
        };
        toasterStore.set({ ...toasterStore.value, [DEVICE]: { ...defaultToasterState, kit } });
        transportStore.set({ ...defaultTransportState, tempo: 240 });

        startSequencer(DEVICE, 120);
        vi.advanceTimersByTime(249);
        expect(triggerToasterPad).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2);

        expect(triggerToasterPad).toHaveBeenCalledTimes(1);
    });

    it('clamps final-step retrigger spill inside every live loop', () => {
        vi.setSystemTime(0);
        vi.mocked(getAudioTime).mockImplementation(() => Date.now() / 1000);
        const kit = kitWithStep(activeStep({ active: false }));
        kit.patterns[0] = {
            ...kit.patterns[0]!,
            stepsPerBar: 4,
            tracks: [
                {
                    padIndex: 0,
                    steps: [
                        activeStep({ active: false }),
                        activeStep({ active: false }),
                        activeStep({ active: false }),
                        activeStep({ microTiming: 0.5, retriggerCount: 2 }),
                    ],
                },
            ],
        };
        toasterStore.set({ ...toasterStore.value, [DEVICE]: { ...defaultToasterState, kit } });

        startSequencer(DEVICE, 120);
        vi.advanceTimersByTime(2_000);
        expect(triggerToasterPad).toHaveBeenCalledTimes(3);
        vi.advanceTimersByTime(2_000);
        expect(triggerToasterPad).toHaveBeenCalledTimes(6);
    });

    it('rejects unsupported groove capability instead of triggering an unmodified live event', () => {
        const kit = kitWithStep(activeStep());
        kit.patterns[0]!.stepsPerBar = 16;
        toasterStore.set({
            ...toasterStore.value,
            [DEVICE]: { ...defaultToasterState, kit },
        });
        createGrooveTemplate({
            id: 'unsupported-live-eighth',
            name: 'Unsupported live eighth',
            subdivision: '1/8',
            slots: [{ index: 0, timingOffset: 0.2, dynamicsOffset: -0.1 }],
            provenance: { type: 'user', sourceId: 'unsupported-live' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:seq-device:A1',
            templateId: 'unsupported-live-eighth',
            amount: 1,
        });

        startSequencer(DEVICE, 120);
        vi.runAllTimers();

        expect(triggerToasterPad).not.toHaveBeenCalled();
        expect(toasterStore.value?.[DEVICE]?.isPlaying).toBe(false);
    });

    it('cancels a pre-scheduled groove hit when the next tick invalidates capability', () => {
        vi.setSystemTime(0);
        vi.mocked(getAudioTime).mockImplementation(() => Date.now() / 1000);
        const kit = kitWithStep(activeStep({ active: false }));
        kit.patterns[0] = {
            ...kit.patterns[0]!,
            stepsPerBar: 16,
            tracks: [
                {
                    padIndex: 0,
                    steps: [
                        activeStep({ active: false }),
                        activeStep(),
                        ...Array.from({ length: 14 }, () => activeStep({ active: false })),
                    ],
                },
            ],
        };
        toasterStore.set({ ...toasterStore.value, [DEVICE]: { ...defaultToasterState, kit } });
        createGrooveTemplate({
            id: 'valid-delayed-pocket',
            name: 'Valid delayed pocket',
            subdivision: '1/16',
            slots: [{ index: 1, timingOffset: 0.4, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'valid-delayed-pocket' },
        });
        createGrooveTemplate({
            id: 'invalidated-pocket',
            name: 'Invalidated pocket',
            subdivision: '1/8',
            slots: [{ index: 1, timingOffset: 0.4, dynamicsOffset: 0 }],
            provenance: { type: 'user', sourceId: 'invalidated-pocket' },
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:seq-device:A1',
            templateId: 'valid-delayed-pocket',
            amount: 1,
        });

        startSequencer(DEVICE, 120);
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:seq-device:A1',
            templateId: 'invalidated-pocket',
            amount: 1,
        });
        vi.advanceTimersByTime(1_000);

        expect(triggerToasterPad).not.toHaveBeenCalled();
        expect(toasterStore.value?.[DEVICE]?.isPlaying).toBe(false);
    });

    it('scopes identical pattern IDs to their durable device owners', () => {
        for (const deviceId of [DEVICE, OTHER]) {
            const kit = kitWithStep(activeStep());
            kit.patterns[0]!.stepsPerBar = 16;
            toasterStore.set({
                ...toasterStore.value,
                [deviceId]: { ...defaultToasterState, kit },
            });
        }
        for (const [id, dynamicsOffset] of [
            ['device-pocket', -0.1],
            ['other-pocket', -0.2],
        ] as const) {
            createGrooveTemplate({
                id,
                name: id,
                subdivision: '1/16',
                slots: [{ index: 0, timingOffset: 0, dynamicsOffset }],
                provenance: { type: 'user', sourceId: id },
            });
        }
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:seq-device:A1',
            templateId: 'device-pocket',
            amount: 1,
        });
        assignGrooveTemplate({
            consumerType: 'toaster-pattern',
            consumerId: 'groove-consumer:other-device:A1',
            templateId: 'other-pocket',
            amount: 1,
        });

        startSequencer(DEVICE, 120);
        startSequencer(OTHER, 120);

        expect(triggerToasterPad).toHaveBeenCalledWith(DEVICE, 0, 114);
        expect(triggerToasterPad).toHaveBeenCalledWith(OTHER, 0, 102);
    });

    // Regression — tick must trigger and route locks to ITS OWN deviceId, not
    // the first toaster device. Previously triggers used the sequencer's id but
    // sound/param locks were routed to getFirstToasterDeviceId(), so instance B
    // drove instance A's worklet.
    it('routes the sound-lock engine swap to its own deviceId', () => {
        seedDevice(OTHER, activeStep({ active: false })); // a "first" device that must not be touched
        seedDevice(DEVICE, activeStep({ soundLock: 'snare-808' }));

        startSequencer(DEVICE, 120);

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

        startSequencer(DEVICE, 120);

        // Before the microtiming delay: no engine swap and no trigger yet.
        expect(setPadEngineImmediate).not.toHaveBeenCalled();
        expect(triggerToasterPad).not.toHaveBeenCalled();

        vi.advanceTimersByTime(800); // 1-step/bar grid: 0.4 * 4 beats at 120 BPM

        // Now the swap-trigger-revert sequence has run.
        expect(triggerToasterPad).toHaveBeenCalledWith(DEVICE, 0, 127);
        expect(setPadEngineImmediate).toHaveBeenCalled();
    });

    // Regression (Fix #2) — microtiming/retrigger fires scheduled by a tick must
    // be cancelled by stopSequencer; otherwise ghost hits land after Stop.
    it('cancels pending microtiming fires on stop (no ghost hits)', () => {
        seedDevice(DEVICE, activeStep({ microTiming: 0.4, retriggerCount: 3 }));

        startSequencer(DEVICE, 120);
        expect(triggerToasterPad).not.toHaveBeenCalled(); // all deferred

        stopSequencer(DEVICE);
        vi.advanceTimersByTime(5000); // would have fired the ghost hits

        expect(triggerToasterPad).not.toHaveBeenCalled();
    });
});
