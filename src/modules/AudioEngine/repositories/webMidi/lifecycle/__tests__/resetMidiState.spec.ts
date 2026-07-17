import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey, type ActiveNoteData, type WebMidiNoteKey } from '../../../../models/WebMidiTypes';

// resetMidiState reads the real `activeNotes`/`channelToNote` singletons and the
// audioEngine context. Mock both: control the active-note map directly and skip
// the hardware all-notes-off send (getMidiAccess/getActiveInput → null).
// Mock specifiers resolve from this test file: `../state` is `../../state`,
// `../../createWebAudioEngine` is `../../../createWebAudioEngine`.
const { activeNotes, channelToNote, get_track_strip } = vi.hoisted(() => ({
    activeNotes: new Map<WebMidiNoteKey, ActiveNoteData>(),
    channelToNote: new Map<number, WebMidiNoteKey>(),
    get_track_strip: vi.fn(),
}));

vi.mock('../../state', () => ({
    activeNotes,
    channelToNote,
}));

vi.mock('../../getMidiAccess', () => ({
    getMidiAccess: () => null,
}));

vi.mock('../../getActiveInput', () => ({
    getActiveInput: () => null,
}));

vi.mock('../../../createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 5 },
        getTrackStrip: get_track_strip,
    },
}));

const { resetMidiState } = await import('../resetMidiState');

function makeOscWithEnv() {
    const setTargetAtTime = vi.fn();
    const stop = vi.fn();
    const osc = {
        _env: { gain: { setTargetAtTime } },
        stop,
    } as unknown as ActiveNoteData['osc'];
    return { osc, setTargetAtTime, stop };
}

beforeEach(() => {
    activeNotes.clear();
    channelToNote.clear();
});

describe('resetMidiState — smooth release on active notes', () => {
    it('applies the exponential release through _env and stops each active oscillator', () => {
        const { osc, setTargetAtTime, stop } = makeOscWithEnv();
        activeNotes.set(createWebMidiNoteKey(0, 60), {
            startTime: 0,
            startBeat: 0,
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            osc,
        });

        resetMidiState();

        // The reset must ramp the envelope to 0 (smooth release) rather than
        // hard-cutting the oscillator. Before scheduleNote attached _env this
        // branch was dead and never ran.
        expect(setTargetAtTime).toHaveBeenCalledTimes(1);
        expect(setTargetAtTime).toHaveBeenCalledWith(0, 5, 0.005);
        // The oscillator is still stopped shortly after.
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it('clears the active-note and channel maps', () => {
        const { osc } = makeOscWithEnv();
        const key = createWebMidiNoteKey(0, 60);
        activeNotes.set(key, {
            startTime: 0,
            startBeat: 0,
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            osc,
        });
        channelToNote.set(0, key);

        resetMidiState();

        expect(activeNotes.size).toBe(0);
        expect(channelToNote.size).toBe(0);
    });

    it('releases each stored Toaster route exactly once before clearing it', () => {
        const noteOffA = vi.fn<(pad: number) => void>();
        const noteOffB = vi.fn<(pad: number) => void>();
        get_track_strip.mockImplementation((trackId: string) => ({
            deviceNodes:
                trackId === 'parent-a'
                    ? [{ deviceId: 'toaster-a', toasterControls: { noteOff: noteOffA } }]
                    : [{ deviceId: 'toaster-b', toasterControls: { noteOff: noteOffB } }],
        }));
        activeNotes.set(createWebMidiNoteKey(1, 61), {
            startTime: 0,
            startBeat: 0,
            channel: 1,
            note: 61,
            trackId: 'removed-child-a',
            instrumentTrackId: 'parent-a',
            toasterRoute: { deviceId: 'toaster-a', pad: 0 },
        });
        activeNotes.set(createWebMidiNoteKey(2, 61), {
            startTime: 0,
            startBeat: 0,
            channel: 2,
            note: 61,
            trackId: 'removed-child-b',
            instrumentTrackId: 'parent-b',
            toasterRoute: { deviceId: 'toaster-b', pad: 3 },
        });

        resetMidiState();
        resetMidiState();

        expect(noteOffA).toHaveBeenCalledExactlyOnceWith(0);
        expect(noteOffB).toHaveBeenCalledExactlyOnceWith(3);
        expect(activeNotes.size).toBe(0);
    });
});
