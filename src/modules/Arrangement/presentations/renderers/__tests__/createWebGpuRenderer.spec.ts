import { describe, it, expect } from 'vitest';

import { computeMidiNoteBeatSpan } from '../createWebGpuRenderer';

// A full WebGPU render is not exercisable under vitest/jsdom (no GPU device),
// so the regression coverage targets the pure clip-relative coordinate math
// that was double-offsetting. This mirrors clipDrawing.spec.ts, which pins the
// Canvas renderer to the same clip-relative convention.
describe('computeMidiNoteBeatSpan (clip-relative MIDI coordinates)', () => {
    it('keeps a note.startBeat=0 note at the clip start, regardless of clip.startBeat', () => {
        // Mirrors clipDrawing.spec.ts: a clip at timeline beat 8 with a single
        // clip-relative note at beat 0. The note must land at relStartBeat 0
        // (the clip's left edge) — NOT at -clip.startBeat. Before the fix the
        // renderer subtracted clip.startBeat, yielding relStartBeat = -8, which
        // failed the visibility cull (relEndBeat <= 0) and dropped the note.
        const clipStartBeat = 8;
        const clipDuration = 12 - clipStartBeat; // clip spans beats 8..12 → 4 beats
        const note = { startBeat: 0, duration: 1 };

        const span = computeMidiNoteBeatSpan(note, /* midiOffset */ 0, /* loopOffset */ 0, clipDuration);

        expect(span.relStartBeat).toBe(0);
        expect(span.relEndBeat).toBe(1);
        expect(span.visible).toBe(true);
    });

    it('does not depend on clip.startBeat: identical relative span for clips at any timeline position', () => {
        const clipDuration = 4;
        const note = { startBeat: 2, duration: 1 };

        // The span is a function of (note, midiOffset, loopOffset, clipDuration)
        // only — clip.startBeat is not an input, so a clip at beat 0 and a clip
        // at beat 100 produce the same clip-relative span.
        const span = computeMidiNoteBeatSpan(note, 0, 0, clipDuration);

        expect(span.relStartBeat).toBe(2);
        expect(span.relEndBeat).toBe(3);
        expect(span.visible).toBe(true);
    });

    it('applies midiOffset by shifting the revealed clip-relative position', () => {
        const clipDuration = 4;
        const note = { startBeat: 2, duration: 1 };

        // midiOffset = 1 reveals content one beat earlier in the clip window.
        const span = computeMidiNoteBeatSpan(note, /* midiOffset */ 1, 0, clipDuration);

        expect(span.relStartBeat).toBe(1);
        expect(span.relEndBeat).toBe(2);
        expect(span.visible).toBe(true);
    });

    it('advances each loop repetition by loopOffset', () => {
        const clipDuration = 8;
        const note = { startBeat: 0, duration: 1 };

        const span = computeMidiNoteBeatSpan(note, 0, /* loopOffset */ 4, clipDuration);

        expect(span.relStartBeat).toBe(4);
        expect(span.relEndBeat).toBe(5);
        expect(span.visible).toBe(true);
    });

    it('enforces a minimum visual duration of 0.125 beats', () => {
        const span = computeMidiNoteBeatSpan({ startBeat: 0, duration: 0 }, 0, 0, 4);

        expect(span.relEndBeat).toBe(0.125);
    });

    it('culls a note whose tail ends at or before the clip start', () => {
        // A note pushed fully before the clip window (e.g. by midiOffset) is
        // not visible.
        const span = computeMidiNoteBeatSpan({ startBeat: 0, duration: 1 }, /* midiOffset */ 2, 0, 4);

        expect(span.relEndBeat).toBeLessThanOrEqual(0);
        expect(span.visible).toBe(false);
    });

    it('culls a note that starts at or past the clip duration', () => {
        const span = computeMidiNoteBeatSpan({ startBeat: 4, duration: 1 }, 0, 0, /* clipDuration */ 4);

        expect(span.relStartBeat).toBeGreaterThanOrEqual(4);
        expect(span.visible).toBe(false);
    });
});
