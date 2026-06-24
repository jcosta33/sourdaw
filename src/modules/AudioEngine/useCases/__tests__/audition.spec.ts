import { describe, it, expect, vi, beforeEach } from 'vitest';

import { playAuditionNote } from '../audition';

const { mocks } = vi.hoisted(() => {
    const cancelScheduledValues = vi.fn();
    const setTargetAtTime = vi.fn();
    const stop = vi.fn();
    return {
        mocks: {
            trackStoreValue: null as unknown,
            cancelScheduledValues,
            setTargetAtTime,
            stop,
            getSynthParamsFromDevices: vi.fn(() => ({
                release: 0.3,
            })),
            // scheduleNote always attaches the amplitude-envelope GainNode as
            // `_env` (see builtinSynth). The audition note-off applies the
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
        ensureTrackStrip: vi.fn(() => ({
            gainNode: {} as AudioNode,
            deviceNodes: [],
        })),
        context: { currentTime: 0 },
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
        mocks.cancelScheduledValues.mockClear();
        mocks.setTargetAtTime.mockClear();
        mocks.stop.mockClear();
    });

    it('falls back to scheduled note when track is missing', () => {
        mocks.trackStoreValue = null;
        playAuditionNote('track-a', 60, 100);
        expect(mocks.scheduleNote).toHaveBeenCalled();
    });

    it('uses track devices to derive synth params when track exists', () => {
        mocks.trackStoreValue = {
            tracks: [{ id: 'track-a', devices: [], parentId: null }],
        };
        playAuditionNote('track-a', 60, 100);
        expect(mocks.getSynthParamsFromDevices).toHaveBeenCalledWith([]);
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
});
