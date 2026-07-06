import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type Step, type ToasterKit, createDefaultKit } from '../../models/ToasterKit';
import { toasterStore, defaultToasterState } from '../../stores/toasterStore';
import { disposeToasterDevice } from '../disposeToasterDevice';
import { isNoteRepeating } from '../isNoteRepeating';
import { startSequencer } from '../sequencerPlayback';
import { enter16Levels, is16LevelsActive, trigger16Level } from '../sixteenLevels';
import { startNoteRepeat } from '../startNoteRepeat';
import { setToasterPadParam } from '../toasterParamBridge/setToasterPadParam';
import { triggerToasterPad } from '../triggerPad';

// The AudioEngine barrel supplies both getAudioTime (sequencer clock) and
// getTrackStrip (the worklet handle setToasterPadParam flushes to). Mock it so
// the rAF pad-param flush has a real strip to target — otherwise the flush
// short-circuits before scheduling a frame and the cancellation can't be proven.
const setPadParam = vi.fn();
vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioTime: vi.fn(() => 0),
    getTrackStrip: vi.fn(() => ({
        deviceNodes: [{ toasterControls: { ready: true, setPadParam } }],
    })),
}));

// findDeviceRef walks getAllTracks(); return a track owning DEVICE so the
// rAF-coalescing path in setToasterPadParam actually schedules a frame.
vi.mock('#/modules/Arrangement/useCases', () => ({
    getAllTracks: vi.fn(() => [{ id: 'track-1', devices: [{ id: 'dispose-device' }] }]),
}));

// triggerToasterPad is the leaf a ghost tick / note-repeat / 16-Levels would
// fire. Spying it lets us assert nothing fires after teardown.
vi.mock('../triggerPad', () => ({
    triggerToasterPad: vi.fn(),
}));

const DEVICE = 'dispose-device';

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

describe('disposeToasterDevice', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        setPadParam.mockClear();
        toasterStore.set({});
    });

    afterEach(() => {
        vi.useRealTimers();
        toasterStore.set({});
    });

    // Bug #3: teardown deleted only the store record, leaving the sequencer
    // running:true with its next-tick setTimeout still armed. The store-delete
    // alone only *masks* the ghost — the next tick early-returns on the missing
    // record. To prove the sequencer itself was stopped (not merely starved of a
    // store), re-seed the record after teardown: a still-armed timer would then
    // tick against it and fire a ghost hit; a stopped sequencer cleared the timer
    // and stays silent.
    it('stops the running sequencer so a re-seeded store fires no ghost tick', () => {
        seedDevice(DEVICE, activeStep());
        startSequencer(DEVICE, 120, 4);

        // The first tick fired (and stored isPlaying:true).
        expect(triggerToasterPad).toHaveBeenCalledWith(DEVICE, 0, 127);
        expect(toasterStore.value?.[DEVICE]?.isPlaying).toBe(true);

        disposeToasterDevice(DEVICE);

        // A device record reappears (e.g. a fresh instance reuses the id, or any
        // store write lands) while the OLD sequencer's timer is still pending.
        seedDevice(DEVICE, activeStep());
        vi.mocked(triggerToasterPad).mockClear();

        // Advancing past several step durations must not fire another tick:
        // a lingering running:true sequencer would re-arm and re-trigger here.
        vi.advanceTimersByTime(5000);
        expect(triggerToasterPad).not.toHaveBeenCalled();
    });

    // Bug #3: per-device note-repeat sessions were never cleared on teardown,
    // so a held note-repeat kept retriggering after the device was gone.
    it('clears an active note-repeat session so it fires no more triggers', () => {
        startNoteRepeat(DEVICE, 0, 100, 120, '1/16');
        expect(isNoteRepeating(DEVICE)).toBe(true);
        const callsAtTeardown = vi.mocked(triggerToasterPad).mock.calls.length;

        disposeToasterDevice(DEVICE);
        expect(isNoteRepeating(DEVICE)).toBe(false);

        vi.advanceTimersByTime(5000);
        expect(vi.mocked(triggerToasterPad).mock.calls.length).toBe(callsAtTeardown);
    });

    // Bug #3: per-device 16-Levels sessions were never cleared, so a stale
    // session would still respond to a grid trigger after teardown.
    it('clears an active 16-Levels session so a later grid hit is inert', () => {
        seedDevice(DEVICE, activeStep());
        enter16Levels(DEVICE, 0, 'velocity');
        expect(is16LevelsActive(DEVICE)).toBe(true);

        disposeToasterDevice(DEVICE);
        expect(is16LevelsActive(DEVICE)).toBe(false);

        vi.mocked(triggerToasterPad).mockClear();
        trigger16Level(8, DEVICE); // a stale session would fire here
        expect(triggerToasterPad).not.toHaveBeenCalled();
    });

    // Bug #3: a pad-param flush already queued on rAF could fire post-destroy,
    // writing to a detached worklet. Teardown must cancel the queued frame.
    it('cancels a queued rAF pad-param flush so it never reaches the worklet', () => {
        seedDevice(DEVICE, activeStep());
        // Queue a coalesced pad-param write (schedules a requestAnimationFrame).
        setToasterPadParam(DEVICE, 0, 'tune', 12);

        disposeToasterDevice(DEVICE);

        // Run any pending rAF/timer callbacks. If the frame were not cancelled,
        // flushPadParam would push to the worklet's setPadParam here.
        vi.runAllTimers();
        expect(setPadParam).not.toHaveBeenCalled();
    });
});
