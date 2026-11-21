import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { defaultTrackState, sanitizeTrackSnapshot, trackStore } from '#/modules/Arrangement/stores';
import { writeNativeBuiltinParameters } from '#/modules/AudioEngine/useCases';

import { type Step, type ToasterKit, createDefaultKit } from '../../models/ToasterKit';
import { toasterStore, defaultToasterState, registerToasterDevice } from '../../stores/toasterStore';
import { disposeEveryToasterDevice } from '../disposeEveryToasterDevice';
import { disposeToasterDevice } from '../disposeToasterDevice';
import { enter16Levels } from '../enter16Levels';
import { is16LevelsActive } from '../is16LevelsActive';
import { isNoteRepeating } from '../isNoteRepeating';
import { resetToasterForProject } from '../resetToasterForProject';
import { startNoteRepeat } from '../startNoteRepeat';
import { startSequencer } from '../startSequencer';
import { setToasterKitParam } from '../toasterParamBridge/setToasterKitParam';
import { setToasterPadParam } from '../toasterParamBridge/setToasterPadParam';
import { trigger16Level } from '../trigger16Level';
import { triggerToasterPad } from '../triggerPad';

// The AudioEngine barrel supplies both getAudioTime (sequencer clock) and
// getTrackStrip (the worklet handle setToasterPadParam flushes to). Mock it so
// the rAF pad-param flush has a real strip to target — otherwise the flush
// short-circuits before scheduling a frame and the cancellation can't be proven.
const setPadParam = vi.fn();
const setSuccessorParam = vi.fn();
const scheduleHit = vi.fn();
const allNotesOff = vi.fn();
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        resolveStoredControllerHosting: actual.resolveStoredControllerHosting,
        findPadOutputHost: actual.findPadOutputHost,
        hasPadOutputHost: actual.hasPadOutputHost,
        findMidiTransformDevice: actual.findMidiTransformDevice,
        isMidiTransformDevice: actual.isMidiTransformDevice,
        builtinSynthVoice: { read: vi.fn() },
        startFaustNote: vi.fn(),
        soundsNativeNotes: vi.fn(() => false),
        writeNativeBuiltinParameters: vi.fn(),
        getAudioTime: vi.fn(() => 0),
        getAudioSampleRate: vi.fn(() => 48_000),
        getToasterDeviceControls: vi.fn(() => ({
            ready: true,
            scheduleHit,
            cancelScheduled: vi.fn(),
            allNotesOff,
        })),
        getTrackStrip: vi.fn((trackId: string) => ({
            deviceNodes: [DEVICE, PENDING_ONLY_DEVICE].map((deviceId) => ({
                deviceId,
                toasterControls: {
                    ready: trackId !== LOADING_TRACK,
                    setPadParam,
                    setParam: trackId === SUCCESSOR_TRACK ? setSuccessorParam : vi.fn(),
                },
            })),
        })),
        applyNoteExpression: vi.fn(),
        audioEngine: {},
        getCompensationDelay: vi.fn(),
        getDefaultBendRangeSemitones: vi.fn(),
        getFactoryDrumKitByIndex: vi.fn(),
        isDeviceCarriedByNativeSession: () => false,
        sendNativeLiveMidiControl: () => Promise.resolve(true),
        sendNativeLiveMidiNote: () => Promise.resolve(true),
        isBypassedNoteReceiver: actual.isBypassedNoteReceiver,
        resolveDrumKitBy: actual.resolveDrumKitBy,
        resolveDrumKitOutputGain: actual.resolveDrumKitOutputGain,
        resolveLiveNoteControls: actual.resolveLiveNoteControls,
        resolveNoteReceivingInstrument: actual.resolveNoteReceivingInstrument,
    };
});

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
/** A device known to Toaster only through a queued parameter write. */
const PENDING_ONLY_DEVICE = 'pending-only-device';
const LOADING_TRACK = 'loading-track';
const SUCCESSOR_TRACK = 'successor-track';

/**
 * Pad writes resolve their target through the Arrangement track store, so the
 * devices must sit on an eligible track for a flush to be queued at all.
 */
function placeDevicesOnTrack(trackId = 'track-1'): void {
    trackStore.set({
        ...defaultTrackState,
        tracks: sanitizeTrackSnapshot({
            tracks: [
                {
                    id: trackId,
                    name: 'Drums',
                    kind: 'midi',
                    devices: [DEVICE, PENDING_ONLY_DEVICE].map((id) => ({
                        id,
                        name: 'Toaster',
                        type: 'toaster',
                        bypassed: false,
                        parameterValues: {},
                    })),
                },
            ],
            selectedTrackId: null,
        }).tracks,
    });
}

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
        scheduleHit.mockClear();
        allNotesOff.mockClear();
        toasterStore.set({});
    });

    afterEach(() => {
        vi.useRealTimers();
        toasterStore.set({});
        trackStore.set(defaultTrackState);
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
        startSequencer(DEVICE, 120);

        // The first tick fired (and stored isPlaying:true).
        expect(scheduleHit).toHaveBeenCalledWith(expect.objectContaining({ pad: 0, velocity: 127 }));
        expect(toasterStore.value?.[DEVICE]?.isPlaying).toBe(true);

        disposeToasterDevice(DEVICE);

        // A device record reappears (e.g. a fresh instance reuses the id, or any
        // store write lands) while the OLD sequencer's timer is still pending.
        seedDevice(DEVICE, activeStep());
        scheduleHit.mockClear();

        // Advancing past several step durations must not fire another tick:
        // a lingering running:true sequencer would re-arm and re-trigger here.
        vi.advanceTimersByTime(5000);
        expect(scheduleHit).not.toHaveBeenCalled();
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

    it('cancels only the disposed device’s queued kit write', () => {
        placeDevicesOnTrack(SUCCESSOR_TRACK);
        registerToasterDevice(DEVICE);
        registerToasterDevice(PENDING_ONLY_DEVICE);
        setToasterKitParam(PENDING_ONLY_DEVICE, 'masterGain', 0.75);
        setToasterKitParam(DEVICE, 'masterGain', 0.123);

        disposeToasterDevice(DEVICE);
        vi.advanceTimersToNextFrame();

        expect(toasterStore.value?.[DEVICE]).toBeUndefined();
        expect(toasterStore.value?.[PENDING_ONLY_DEVICE]?.kit.masterGain).toBe(0.75);
        expect(setSuccessorParam).toHaveBeenCalledExactlyOnceWith('master_gain', 0.75);
        expect(writeNativeBuiltinParameters).toHaveBeenCalledExactlyOnceWith(SUCCESSOR_TRACK, PENDING_ONLY_DEVICE, {
            master_gain: 0.75,
        });
    });

    // Bug #3: a pad-param flush already queued on rAF could fire post-destroy,
    // writing to a detached worklet. Teardown must cancel the queued frame.
    it('cancels a queued rAF pad-param flush so it never reaches the worklet', () => {
        placeDevicesOnTrack();
        seedDevice(DEVICE, activeStep());
        const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame');
        // Queue a coalesced pad-param write (schedules a requestAnimationFrame).
        setToasterPadParam(DEVICE, 0, 'tune', 12);

        disposeToasterDevice(DEVICE);

        // Run any pending rAF/timer callbacks. If the frame were not cancelled,
        // flushPadParam would push to the worklet's setPadParam here.
        vi.runAllTimers();
        expect(setPadParam).not.toHaveBeenCalled();
        expect(cancelFrame).toHaveBeenCalledOnce();
    });
});

// A graph reset announces no device removal, so a project switch ends the
// outgoing project's devices here instead, including sessions of a device the
// store holds no record for.
describe('disposeEveryToasterDevice', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        toasterStore.set({});
    });

    afterEach(() => {
        vi.useRealTimers();
        toasterStore.set({});
        trackStore.set(defaultTrackState);
    });

    it('ends every device the outgoing project left a record or a session for', () => {
        seedDevice(DEVICE, activeStep());
        startSequencer(DEVICE, 120);
        startNoteRepeat('repeat-device', 0, 100, 120, '1/16');
        enter16Levels('levels-device', 0, 'velocity');

        disposeEveryToasterDevice();

        expect(toasterStore.value).toEqual({});
        expect(isNoteRepeating('repeat-device')).toBe(false);
        expect(is16LevelsActive('levels-device')).toBe(false);
        seedDevice(DEVICE, activeStep());
        scheduleHit.mockClear();
        vi.advanceTimersByTime(5000);
        expect(scheduleHit).not.toHaveBeenCalled();
    });

    // A device can leave nothing behind but a queued pad flush; the switch must
    // still cancel it, or the frame writes the old project's edit to a worklet.
    it('cancels a queued pad flush for a device with no store record or session', () => {
        placeDevicesOnTrack();
        const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame');
        setToasterPadParam(PENDING_ONLY_DEVICE, 0, 'tune', 12);
        expect(toasterStore.value).toEqual({});

        disposeEveryToasterDevice();
        vi.advanceTimersToNextFrame();

        expect(setPadParam).not.toHaveBeenCalled();
        expect(cancelFrame).toHaveBeenCalledOnce();
    });

    it('keeps the outgoing loading device’s Master edit away from a same-ID successor', () => {
        placeDevicesOnTrack(LOADING_TRACK);
        setToasterKitParam(PENDING_ONLY_DEVICE, 'masterGain', 0.123);
        expect(toasterStore.value).toEqual({});

        resetToasterForProject();
        placeDevicesOnTrack(SUCCESSOR_TRACK);
        registerToasterDevice(PENDING_ONLY_DEVICE);
        expect(toasterStore.value?.[PENDING_ONLY_DEVICE]?.kit.masterGain).toBe(defaultToasterState.kit.masterGain);
        vi.advanceTimersToNextFrame();

        expect(setSuccessorParam.mock.calls).toEqual([]);
        expect(writeNativeBuiltinParameters).not.toHaveBeenCalled();

        setToasterKitParam(PENDING_ONLY_DEVICE, 'masterGain', 0.75);
        vi.advanceTimersToNextFrame();
        expect(toasterStore.value?.[PENDING_ONLY_DEVICE]?.kit.masterGain).toBe(0.75);
        expect(setSuccessorParam).toHaveBeenCalledExactlyOnceWith('master_gain', 0.75);
        expect(writeNativeBuiltinParameters).toHaveBeenCalledExactlyOnceWith(SUCCESSOR_TRACK, PENDING_ONLY_DEVICE, {
            master_gain: 0.75,
        });
    });
});
