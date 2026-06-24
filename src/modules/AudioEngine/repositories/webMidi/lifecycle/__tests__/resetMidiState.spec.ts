import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActiveNoteData } from '../../../../models/WebMidiTypes';

// resetMidiState reads the real `activeNotes`/`channelToNote` singletons and the
// audioEngine context. Mock both: control the active-note map directly and skip
// the hardware all-notes-off send (getMidiAccess/getActiveInput → null).
// Mock specifiers resolve from this test file: `../state` is `../../state`,
// `../../createWebAudioEngine` is `../../../createWebAudioEngine`.
const { activeNotes, channelToNote } = vi.hoisted(() => ({
    activeNotes: new Map<number, ActiveNoteData>(),
    channelToNote: new Map<number, number>(),
}));

vi.mock('../../state', () => ({
    activeNotes,
    channelToNote,
    getMidiAccess: () => null,
    getActiveInput: () => null,
}));

vi.mock('../../../createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 5 },
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
        activeNotes.set(60, { startTime: 0, startBeat: 0, channel: 0, osc });

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
        activeNotes.set(60, { startTime: 0, startBeat: 0, channel: 0, osc });
        channelToNote.set(1, 60);

        resetMidiState();

        expect(activeNotes.size).toBe(0);
        expect(channelToNote.size).toBe(0);
    });
});
