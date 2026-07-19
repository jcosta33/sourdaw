import { describe, it, expect, vi, beforeEach } from 'vitest';

import { playAuditionNote } from '../audition';

type MockToasterControls = {
    ready: boolean;
    noteOn: (pad: number, velocity: number, pitch: number) => void;
    noteOff: (pad: number) => void;
};

type MockDeviceNode = {
    deviceId: string;
    type: string;
    toasterControls?: MockToasterControls;
};

type MockTrackStrip = {
    gainNode: AudioNode;
    deviceNodes: MockDeviceNode[];
};

const { mocks } = vi.hoisted(() => {
    const cancelScheduledValues = vi.fn();
    const setTargetAtTime = vi.fn();
    const stop = vi.fn();
    const audioContext = { currentTime: 0 };
    const synthParams = { release: 0.3 };
    const defaultTrackStrip: MockTrackStrip = {
        gainNode: {} as AudioNode,
        deviceNodes: [],
    };
    const trackStrips = new Map<string, MockTrackStrip>();
    const ensureTrackStrip = vi.fn((trackId: string) => trackStrips.get(trackId) ?? defaultTrackStrip);

    const trackStoreValue: unknown = null;

    return {
        mocks: {
            trackStoreValue,
            audioContext,
            synthParams,
            defaultTrackStrip,
            trackStrips,
            ensureTrackStrip,
            cancelScheduledValues,
            setTargetAtTime,
            stop,
            getSynthParamsFromDevices: vi.fn(() => synthParams),
            // scheduleNote always attaches the amplitude-envelope GainNode as
            // `_env` (see the built-in synth scheduler). The audition note-off applies the
            // exponential smooth release through it.
            scheduleNote: vi.fn(
                () =>
                    ({
                        stop,
                        _env: { gain: { cancelScheduledValues, setTargetAtTime } },
                    }) as unknown as OscillatorNode & { _env: GainNode }
            ),
        },
    };
});

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        ensureTrackStrip: mocks.ensureTrackStrip,
        context: mocks.audioContext,
    },
}));

vi.mock('#/modules/Synth/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Synth/useCases')>();
    return {
        ...actual,
        getDrumKitDefByIndex: vi.fn(() => null),
        scheduleDrumKitNote: vi.fn(),
        scheduleNote: mocks.scheduleNote,
        getSynthParamsFromDevices: mocks.getSynthParamsFromDevices,
    };
});

vi.mock('../faustScheduler/startFaustNote', () => ({
    startFaustNote: vi.fn(() => () => {}),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return {
        ...actual,
        trackStore: {
            get value() {
                return mocks.trackStoreValue;
            },
        },
    };
});

describe('playAuditionNote', () => {
    beforeEach(() => {
        mocks.trackStoreValue = null;
        mocks.trackStrips.clear();
        mocks.ensureTrackStrip.mockClear();
        mocks.cancelScheduledValues.mockClear();
        mocks.setTargetAtTime.mockClear();
        mocks.stop.mockClear();
        mocks.scheduleNote.mockClear();
        mocks.getSynthParamsFromDevices.mockClear();
    });

    it('falls back to scheduled note when track is missing', () => {
        mocks.trackStoreValue = null;
        playAuditionNote('track-a', 60, 100);
        expect(mocks.scheduleNote).toHaveBeenCalledWith(
            mocks.audioContext,
            mocks.defaultTrackStrip.gainNode,
            60,
            0,
            60,
            100,
            mocks.synthParams
        );
    });

    it('uses track devices to derive synth params when track exists', () => {
        const trackDevices = [
            {
                id: 'synth-device',
                type: 'builtin-poly-synth',
                parameterValues: { attack: 0.1, release: 0.2 },
            },
        ];
        mocks.trackStoreValue = {
            tracks: [{ id: 'track-a', devices: trackDevices, parentId: null }],
        };
        playAuditionNote('track-a', 60, 100);
        expect(mocks.getSynthParamsFromDevices).toHaveBeenCalledWith(trackDevices);
    });

    it('applies the exponential smooth release through _env on note-off (not a hard stop)', () => {
        // Regression: scheduleNote now attaches _env, so the note-off must run
        // the smooth release (cancel + setTargetAtTime) before stopping the
        // oscillator. Before the fix _env was never set and this branch was dead.
        mocks.trackStoreValue = null;
        const stopNote = playAuditionNote('track-a', 60, 100);
        stopNote();

        expect(mocks.cancelScheduledValues).toHaveBeenCalledTimes(1);
        expect(mocks.setTargetAtTime).toHaveBeenCalledTimes(1);
        // setTargetAtTime(target=0, startTime, timeConstant=release/3)
        expect(mocks.setTargetAtTime).toHaveBeenCalledWith(0, expect.any(Number), 0.3 / 3);
        // The oscillator still stops after the release tail.
        expect(mocks.stop).toHaveBeenCalledTimes(1);
    });

    it('maps a parent toaster audition pitch to the expected pad and releases it', () => {
        const toasterNoteOn = vi.fn();
        const toasterNoteOff = vi.fn();
        mocks.trackStrips.set('parent-track', {
            gainNode: {} as AudioNode,
            deviceNodes: [
                {
                    deviceId: 'toaster-device',
                    type: 'toaster',
                    toasterControls: {
                        ready: true,
                        noteOn: toasterNoteOn,
                        noteOff: toasterNoteOff,
                    },
                },
            ],
        });
        mocks.trackStoreValue = {
            tracks: [
                {
                    id: 'parent-track',
                    devices: [{ id: 'toaster-device', type: 'toaster', parameterValues: {} }],
                    parentId: null,
                },
            ],
        };

        const stopNote = playAuditionNote('parent-track', 43, 91);

        expect(toasterNoteOn).toHaveBeenCalledWith(7, 91, 43);
        stopNote();
        expect(toasterNoteOff).toHaveBeenCalledWith(7);
    });

    it('uses the parent toaster strip and matched device when auditioning a child track', () => {
        const decoyNoteOn = vi.fn();
        const toasterNoteOn = vi.fn();
        const toasterNoteOff = vi.fn();
        mocks.trackStrips.set('child-b', {
            gainNode: {} as AudioNode,
            deviceNodes: [],
        });
        mocks.trackStrips.set('parent-track', {
            gainNode: {} as AudioNode,
            deviceNodes: [
                {
                    deviceId: 'other-device',
                    type: 'toaster',
                    toasterControls: {
                        ready: true,
                        noteOn: decoyNoteOn,
                        noteOff: vi.fn(),
                    },
                },
                {
                    deviceId: 'toaster-device',
                    type: 'plugin-wrapper',
                    toasterControls: {
                        ready: true,
                        noteOn: toasterNoteOn,
                        noteOff: toasterNoteOff,
                    },
                },
            ],
        });
        mocks.trackStoreValue = {
            tracks: [
                {
                    id: 'parent-track',
                    devices: [{ id: 'toaster-device', type: 'toaster', parameterValues: {} }],
                    parentId: null,
                },
                {
                    id: 'child-a',
                    devices: [],
                    parentId: 'parent-track',
                },
                {
                    id: 'child-b',
                    devices: [],
                    parentId: 'parent-track',
                },
            ],
        };

        const stopNote = playAuditionNote('child-b', 48, 64);

        expect(mocks.ensureTrackStrip).toHaveBeenNthCalledWith(1, 'child-b');
        expect(mocks.ensureTrackStrip).toHaveBeenNthCalledWith(2, 'parent-track');
        expect(decoyNoteOn).not.toHaveBeenCalled();
        expect(toasterNoteOn).toHaveBeenCalledWith(1, 64, 48);
        stopNote();
        expect(toasterNoteOff).toHaveBeenCalledWith(1);
    });
});
