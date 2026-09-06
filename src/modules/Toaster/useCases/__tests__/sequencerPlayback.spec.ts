import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { getAudioTime } from '#/modules/AudioEngine/useCases';
import { defaultGrooveTemplateState, grooveTemplateStore } from '#/modules/MIDI/stores';
import { assignGrooveTemplate, createGrooveTemplate } from '#/modules/MIDI/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { type Step, type ToasterKit, createDefaultKit } from '../../models/ToasterKit';
import { toasterStore, defaultToasterState } from '../../stores/toasterStore';
import { cancelScheduledToasterHits } from '../cancelScheduledToasterHits';
import { releaseToasterNotes } from '../releaseToasterNotes';
import { scheduleToasterHit } from '../scheduleToasterHit';
import { startSequencer } from '../startSequencer';
import { stopSequencer } from '../stopSequencer';
import { TOASTER_ENGINE_MAP } from '../toasterEngineMap';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    soundsNativeNotes: vi.fn(() => false),
    getAudioTime: vi.fn(() => 0),
    applyNoteExpression: vi.fn(),
    audioEngine: {},
    getCompensationDelay: vi.fn(),
    getDefaultBendRangeSemitones: vi.fn(),
    getFactoryDrumKitByIndex: vi.fn(),
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: () => Promise.resolve(true),
}));

vi.mock('../scheduleToasterHit', () => ({
    scheduleToasterHit: vi.fn(),
}));

vi.mock('../cancelScheduledToasterHits', () => ({
    cancelScheduledToasterHits: vi.fn(),
}));

vi.mock('../releaseToasterNotes', () => ({
    releaseToasterNotes: vi.fn(),
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
        transportStore.set({ ...transportStore.value!, tempo: 120 });
    });

    afterEach(() => {
        stopSequencer(DEVICE);
        stopSequencer(OTHER);
        vi.useRealTimers();
        toasterStore.set({});
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

        expect(scheduleToasterHit).toHaveBeenCalledWith(
            expect.objectContaining({
                deviceId: DEVICE,
                padIndex: 0,
                velocity: 114,
                targetTimeSeconds: 0.025,
            })
        );
    });

    // Regression — tick must trigger and route locks to ITS OWN deviceId, not
    // the first toaster device. Previously triggers used the sequencer's id but
    // sound/param locks were routed to getFirstToasterDeviceId(), so instance B
    // drove instance A's worklet.
    it('routes the sound-lock engine swap to its own deviceId', () => {
        seedDevice(OTHER, activeStep({ active: false })); // a "first" device that must not be touched
        seedDevice(DEVICE, activeStep({ soundLock: 'snare-808' }));

        startSequencer(DEVICE, 120);

        const scheduled = vi.mocked(scheduleToasterHit).mock.calls[0]?.[0];
        expect(scheduled?.deviceId).toBe(DEVICE);
        expect(scheduled?.padIndex).toBe(0);
        expect(scheduled?.velocity).toBe(127);
        expect(scheduled?.padParams?.some((param) => param.name === 'engineType')).toBe(true);
        expect(scheduled?.restoreEngineType).toBe(TOASTER_ENGINE_MAP['kick-808']);
    });

    // Regression (Fix #4) — for a delayed (microtiming) sound-locked step the
    // engine swap must ride inside the deferred fire, not mutate the shared slot
    // before the delay. So no swap happens until the delay elapses.
    it('queues delayed sound locks on the audio clock without waiting for a main-thread timer', () => {
        seedDevice(DEVICE, activeStep({ soundLock: 'snare-808', microTiming: 0.4 }));

        startSequencer(DEVICE, 120);

        const scheduled = vi
            .mocked(scheduleToasterHit)
            .mock.calls.find(([input]) => input.targetTimeSeconds === 0.8)?.[0];
        expect(scheduled?.deviceId).toBe(DEVICE);
        expect(scheduled?.padIndex).toBe(0);
        expect(scheduled?.velocity).toBe(127);
        expect(scheduled?.padParams?.some((param) => param.name === 'engineType')).toBe(true);
        expect(scheduled?.restoreEngineType).toBe(TOASTER_ENGINE_MAP['kick-808']);
    });

    // Regression (Fix #2) — microtiming/retrigger fires scheduled by a tick must
    // be cancelled by stopSequencer; otherwise ghost hits land after Stop.
    it('releases worklet-queued hits on stop so no ghost hit survives', () => {
        seedDevice(DEVICE, activeStep({ microTiming: 0.4, retriggerCount: 3 }));

        startSequencer(DEVICE, 120);
        const scheduledBeforeStop = vi.mocked(scheduleToasterHit).mock.calls.length;
        expect(scheduledBeforeStop).toBeGreaterThan(0);

        stopSequencer(DEVICE);
        vi.advanceTimersByTime(5000); // would have fired the ghost hits

        expect(releaseToasterNotes).toHaveBeenCalledWith(DEVICE);
        expect(scheduleToasterHit).toHaveBeenCalledTimes(scheduledBeforeStop);
    });

    it('queues fill-conditioned hits at their projected time even before fill is active', () => {
        seedDevice(DEVICE, activeStep({ condition: 'fill', microTiming: -0.25 }));

        startSequencer(DEVICE, 120);

        expect(scheduleToasterHit).toHaveBeenCalledWith(
            expect.objectContaining({
                deviceId: DEVICE,
                fillCondition: 'fill',
                targetTimeSeconds: 0,
            })
        );
    });

    it('cancels queued lookahead when tempo changes before projecting the replacement', () => {
        seedDevice(DEVICE, activeStep());
        startSequencer(DEVICE, 120);
        vi.mocked(getAudioTime).mockReturnValue(2);

        transportStore.set({ ...transportStore.value!, tempo: 90 });
        vi.advanceTimersByTime(2000);

        expect(cancelScheduledToasterHits).toHaveBeenCalledWith(DEVICE);
    });

    it('anchors lookahead hits to logical tick deadlines when a callback runs late', () => {
        const kit = kitWithStep(activeStep());
        kit.patterns[0]!.stepsPerBar = 16;
        kit.patterns[0]!.tracks[0]!.steps = Array.from({ length: 16 }, () => activeStep());
        toasterStore.set({
            ...toasterStore.value,
            [DEVICE]: { ...defaultToasterState, kit },
        });

        startSequencer(DEVICE, 120);
        vi.mocked(scheduleToasterHit).mockClear();
        vi.mocked(getAudioTime).mockReturnValue(0.175);

        vi.advanceTimersByTime(125);

        expect(scheduleToasterHit).toHaveBeenCalledWith(
            expect.objectContaining({
                deviceId: DEVICE,
                targetTimeSeconds: 0.25,
            })
        );
    });

    it('skips genuinely missed deadlines and schedules the first future step', () => {
        const kit = kitWithStep(activeStep());
        kit.patterns[0]!.stepsPerBar = 16;
        kit.patterns[0]!.tracks[0]!.steps = Array.from({ length: 16 }, () => activeStep());
        toasterStore.set({
            ...toasterStore.value,
            [DEVICE]: { ...defaultToasterState, kit },
        });

        startSequencer(DEVICE, 120);
        vi.mocked(scheduleToasterHit).mockClear();
        vi.mocked(getAudioTime).mockReturnValue(0.4);

        vi.advanceTimersByTime(125);

        expect(scheduleToasterHit).toHaveBeenCalledTimes(1);
        expect(scheduleToasterHit).toHaveBeenCalledWith(
            expect.objectContaining({
                deviceId: DEVICE,
                targetTimeSeconds: 0.5,
            })
        );
    });
});
