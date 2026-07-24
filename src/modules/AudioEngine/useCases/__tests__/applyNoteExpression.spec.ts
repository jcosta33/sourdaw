import { beforeEach, describe, expect, it, vi } from 'vitest';

const get_track_strip = vi.hoisted(() => vi.fn());

vi.mock('../engineAccess/getAudioContext', () => ({
    audioEngine: { getTrackStrip: get_track_strip },
}));

const { applyNoteExpression } = await import('../noteExpression/applyNoteExpression');
const { getNoteExpressionDimensions } = await import('../noteExpression/getNoteExpressionDimensions');

/** (note, channel, bendSemitones, pressure, slide, sampleFrame). */
type NoteExpressionCall = [number, number, number, number, number, number | undefined];

function stripWith(deviceType: string, controlsKey: string, noteExpression: (...args: NoteExpressionCall) => void) {
    return {
        deviceNodes: [{ type: deviceType, [controlsKey]: { noteExpression } }],
    };
}

describe('applyNoteExpression (audit MD-2)', () => {
    beforeEach(() => {
        get_track_strip.mockReset();
    });

    it('converts captured wire units into engine units for the instrument voice', () => {
        const noteExpression = vi.fn();
        get_track_strip.mockReturnValue(stripWith('fermenter', 'fermenterControls', noteExpression));

        const applied = applyNoteExpression({
            trackId: 'track-1',
            note: 64,
            channel: 3,
            // Half of the 14-bit positive range, full pressure, CC74 fully up.
            expression: { pitchBend: 4096, pressure: 127, slide: 127 },
            sampleFrame: 9600,
        });

        expect(applied).toBe(true);
        expect(get_track_strip).toHaveBeenCalledWith('track-1');
        const [note, channel, bendSemitones, pressure, slide, sampleFrame] = noteExpression.mock
            .calls[0] as NoteExpressionCall;
        expect(note).toBe(64);
        expect(channel).toBe(3);
        // 4096 / 8192 of the ±48 semitone MPE member range.
        expect(bendSemitones).toBeCloseTo(24, 6);
        expect(pressure).toBeCloseTo(1, 6);
        expect(slide).toBeCloseTo(1, 6);
        expect(sampleFrame).toBe(9600);
    });

    it('addresses the non-MPE channel when the caller has none', () => {
        const noteExpression = vi.fn();
        get_track_strip.mockReturnValue(stripWith('fermenter', 'fermenterControls', noteExpression));

        applyNoteExpression({ trackId: 'track-1', note: 60, expression: { pressure: 64 } });

        const [, channel] = noteExpression.mock.calls[0] as NoteExpressionCall;
        expect(channel).toBe(0);
    });

    it('centres CC74 timbre on its rest position and honours a non-MPE bend range', () => {
        const noteExpression = vi.fn();
        get_track_strip.mockReturnValue(stripWith('levain', 'levainControls', noteExpression));

        applyNoteExpression({
            trackId: 'track-1',
            note: 60,
            expression: { pitchBend: -8192, slide: 64 },
            bendRangeSemitones: 2,
        });

        const [, , bendSemitones, pressure, slide] = noteExpression.mock.calls[0] as NoteExpressionCall;
        expect(bendSemitones).toBeCloseTo(-2, 6);
        // CC74 at 64 is the neutral rest position — no timbre shift.
        expect(slide).toBeCloseTo(0, 6);
        // A dimension the note does not carry resolves to neutral, not NaN.
        expect(pressure).toBe(0);
    });

    it('clamps out-of-range wire values instead of forwarding them', () => {
        const noteExpression = vi.fn();
        get_track_strip.mockReturnValue(stripWith('fermenter', 'fermenterControls', noteExpression));

        applyNoteExpression({
            trackId: 'track-1',
            note: 60,
            expression: { pitchBend: 99_999, pressure: 999, slide: 999 },
        });

        const [, , bendSemitones, pressure, slide] = noteExpression.mock.calls[0] as NoteExpressionCall;
        expect(bendSemitones).toBeCloseTo(48 * (8191 / 8192), 4);
        expect(pressure).toBe(1);
        expect(slide).toBeCloseTo(1, 6);
    });

    it('does nothing when the note carries no expression', () => {
        const noteExpression = vi.fn();
        get_track_strip.mockReturnValue(stripWith('fermenter', 'fermenterControls', noteExpression));

        const applied = applyNoteExpression({ trackId: 'track-1', note: 60, expression: {} });

        expect(applied).toBe(false);
        expect(noteExpression).not.toHaveBeenCalled();
        expect(get_track_strip).not.toHaveBeenCalled();
    });

    it('reports no consumer when the track instrument has no expression path', () => {
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'toaster', toasterControls: { noteOn: vi.fn() } }],
        });

        const applied = applyNoteExpression({
            trackId: 'track-1',
            note: 60,
            expression: { pressure: 100 },
        });

        expect(applied).toBe(false);
    });

    it('reports no consumer when the track has no strip yet', () => {
        get_track_strip.mockReturnValue(undefined);

        const applied = applyNoteExpression({
            trackId: 'missing',
            note: 60,
            expression: { pressure: 100 },
        });

        expect(applied).toBe(false);
    });

    it('still forwards Grand Boule pressure and slide, which its engine drops', () => {
        // The registry advertises pitch bend only for grand-boule, so the editor
        // never offers the other two lanes; a value that arrives anyway (e.g. a
        // clip authored on another instrument) is passed on and dropped at the
        // engine rather than being special-cased here.
        const noteExpression = vi.fn();
        get_track_strip.mockReturnValue(stripWith('grand-boule', 'grandBouleControls', noteExpression));

        const applied = applyNoteExpression({
            trackId: 'track-1',
            note: 60,
            expression: { pressure: 127 },
        });

        expect(applied).toBe(true);
        const [, , bendSemitones, pressure] = noteExpression.mock.calls[0] as NoteExpressionCall;
        expect(bendSemitones).toBe(0);
        expect(pressure).toBeCloseTo(1, 6);
    });

    it('registers the dimensions each engine genuinely sounds', () => {
        expect([...getNoteExpressionDimensions('fermenter')]).toEqual(['pitchBend', 'pressure', 'slide']);
        expect([...getNoteExpressionDimensions('levain')]).toEqual(['pitchBend', 'pressure', 'slide']);
        // A struck string has no continuous pressure or timbre response.
        expect([...getNoteExpressionDimensions('grand-boule')]).toEqual(['pitchBend']);
        // Pad-indexed one-shots have no per-note voice to address.
        expect([...getNoteExpressionDimensions('toaster')]).toEqual([]);
    });
});
