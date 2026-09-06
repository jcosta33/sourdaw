import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey, type ActiveNoteData, type WebMidiNoteKey } from '../../../../models/WebMidiTypes';

// resetMidiState reads the real `activeNotes`/`channelToNote` singletons and
// receives engine access (`getCurrentTime` / `getTrackStrip`) injected via its
// deps argument. Skip the hardware all-notes-off send (getMidiAccess /
// getActiveInput → null); `../state` mock resolves as `../../state`.
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

const { resetMidiState } = await import('../resetMidiState');

const reset_deps = { getCurrentTime: () => 5, getTrackStrip: get_track_strip, releaseNativeNote: () => {} };

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
    get_track_strip.mockReset();
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

        resetMidiState(reset_deps);

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

        resetMidiState(reset_deps);

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

        resetMidiState(reset_deps);
        resetMidiState(reset_deps);

        expect(noteOffA).toHaveBeenCalledExactlyOnceWith(0);
        expect(noteOffB).toHaveBeenCalledExactlyOnceWith(3);
        expect(activeNotes.size).toBe(0);
    });

    // audit MD-6 — reset released Toaster pads and raw oscillators only, then
    // cleared the map. A Fermenter / Grand Boule / Levain voice was left
    // sounding with nothing left that knew about it, so the later real note-off
    // found no record and never reached the engine.
    describe('worklet instrument voices', () => {
        it('releases a held Fermenter voice before forgetting the note', () => {
            const noteOff = vi.fn<(note: number, sampleFrame?: number) => void>();
            get_track_strip.mockReturnValue({
                deviceNodes: [{ deviceId: 'ferm-1', type: 'fermenter', fermenterControls: { noteOff } }],
            });
            activeNotes.set(createWebMidiNoteKey(0, 60), {
                startTime: 0,
                startBeat: 0,
                channel: 0,
                note: 60,
                trackId: 'track-1',
                instrumentTrackId: 'track-1',
                fermenterDeviceId: 'ferm-1',
            });

            resetMidiState(reset_deps);

            expect(noteOff).toHaveBeenCalledExactlyOnceWith(60);
        });

        it('releases a held Grand Boule voice', () => {
            const noteOff = vi.fn<(midiNote: number) => void>();
            get_track_strip.mockReturnValue({
                deviceNodes: [{ deviceId: 'gb-1', type: 'grand-boule', grandBouleControls: { noteOff } }],
            });
            activeNotes.set(createWebMidiNoteKey(0, 48), {
                startTime: 0,
                startBeat: 0,
                channel: 0,
                note: 48,
                trackId: 'track-1',
                instrumentTrackId: 'track-1',
                grandBouleDeviceId: 'gb-1',
            });

            resetMidiState(reset_deps);

            expect(noteOff).toHaveBeenCalledExactlyOnceWith(48);
        });

        it('releases a held Levain voice', () => {
            const noteOff = vi.fn<(note: number) => void>();
            get_track_strip.mockReturnValue({
                deviceNodes: [{ deviceId: 'lev-1', type: 'levain', levainControls: { noteOff } }],
            });
            activeNotes.set(createWebMidiNoteKey(0, 72), {
                startTime: 0,
                startBeat: 0,
                channel: 0,
                note: 72,
                trackId: 'track-1',
                instrumentTrackId: 'track-1',
                levainDeviceId: 'lev-1',
            });

            resetMidiState(reset_deps);

            expect(noteOff).toHaveBeenCalledExactlyOnceWith(72);
        });
    });
});
