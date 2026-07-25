import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: true }));

const apply_note_expression = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: { currentTime: 2, sampleRate: 48000 },
    },
    applyNoteExpression: apply_note_expression,
}));

const { handleWebMidiChannelPressure } = await import('../handleWebMidiChannelPressure');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

/**
 * Frame live expression lands on with the harness clock at 2 s / 48 kHz and no
 * event timestamp: the arrival frame plus the one-render-quantum scheduling
 * budget `resolveInputDispatchFrame` applies (audit MD-1).
 */
const LIVE_DISPATCH_FRAME = 96_128;

describe('handleWebMidiChannelPressure', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        apply_note_expression.mockClear();
        mpe_enabled.value = true;
    });

    // audit MD-2 — pressure must reach the instrument voice, not only note state.
    it('routes pressure to the note instrument through the shared expression surface', () => {
        const key = createWebMidiNoteKey(3, 62);
        activeNotes.set(key, {
            channel: 3,
            note: 62,
            trackId: 'source-track',
            instrumentTrackId: 'instrument-track',
            startTime: 0,
            startBeat: 0,
            pitchBend: -2048,
        });
        channelToNote.set(3, key);

        handleWebMidiChannelPressure(3, 96);

        expect(apply_note_expression).toHaveBeenCalledTimes(1);
        expect(apply_note_expression).toHaveBeenCalledWith({
            trackId: 'instrument-track',
            note: 62,
            channel: 3,
            expression: { pitchBend: -2048, pressure: 96, slide: undefined },
            sampleFrame: LIVE_DISPATCH_FRAME,
        });
    });

    it('does not reach the instrument when no note owns the channel', () => {
        handleWebMidiChannelPressure(5, 96);

        expect(apply_note_expression).not.toHaveBeenCalled();
    });

    it('should store pressure on the active MPE note for the matching channel', () => {
        const matchingKey = createWebMidiNoteKey(3, 62);
        const otherKey = createWebMidiNoteKey(4, 62);
        activeNotes.set(matchingKey, {
            channel: 3,
            note: 62,
            trackId: 'track-a',
            instrumentTrackId: 'track-a',
            startTime: 0,
            startBeat: 0,
        });
        activeNotes.set(otherKey, {
            channel: 4,
            note: 62,
            trackId: 'track-b',
            instrumentTrackId: 'track-b',
            startTime: 0,
            startBeat: 0,
        });
        channelToNote.set(3, matchingKey);
        channelToNote.set(4, otherKey);

        handleWebMidiChannelPressure(3, 87);

        expect(activeNotes.get(matchingKey)?.pressure).toBe(87);
        expect(activeNotes.get(otherKey)?.pressure).toBeUndefined();
    });

    it('should not update pressure when MPE is disabled', () => {
        mpe_enabled.value = false;
        const key = createWebMidiNoteKey(3, 62);
        activeNotes.set(key, {
            channel: 3,
            note: 62,
            trackId: 'track-a',
            instrumentTrackId: 'track-a',
            startTime: 0,
            startBeat: 0,
        });
        channelToNote.set(3, key);

        handleWebMidiChannelPressure(3, 87);

        expect(activeNotes.get(key)?.pressure).toBeUndefined();
    });
});
