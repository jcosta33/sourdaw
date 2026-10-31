import { describe, expect, it } from 'vitest';

import {
    findInlineMidiNoteAt,
    forEachMidiNoteRect,
    resolveInlineMidiPointer,
    resolveInlineNoteBeat,
    resolveMidiPitchWindow,
    type InlineMidiFrame,
    type InlineMidiGeometryClip,
    type InlineMidiTimingClip,
} from '../InlineMidiGeometry';

type Note = InlineMidiGeometryClip['midiNotes'][number];

const note = (id: string, pitch: number, startBeat: number, duration: number): Note => ({
    id,
    pitch,
    startBeat,
    duration,
});

const PIXELS_PER_BEAT = 50;

const frameFor = (clip: InlineMidiGeometryClip, contentTop = 2, contentHeight = 76): InlineMidiFrame => ({
    x: clip.startBeat * PIXELS_PER_BEAT,
    width: (clip.endBeat - clip.startBeat) * PIXELS_PER_BEAT,
    contentTop,
    contentHeight,
});

// Starts at beat 8, plays from one beat into its notes, and loops every three
// beats inside an eight-beat clip: the case the clip-at-zero specs could not see.
const offsetLoopedClip = (): InlineMidiGeometryClip => ({
    startBeat: 8,
    endBeat: 16,
    midiOffsetBeats: 1,
    loopEnabled: true,
    loopLength: 3,
    midiNotes: [note('high', 64, 1.5, 1), note('low', 55, 2.5, 0.5)],
});

const collectRects = (clip: InlineMidiGeometryClip, frame: InlineMidiFrame) => {
    const window = resolveMidiPitchWindow(clip.midiNotes, true, frame.contentHeight);
    const rects: Array<{ id: string; pitch: number; x: number; y: number; width: number; height: number }> = [];
    forEachMidiNoteRect(clip, frame, window, { inline: true }, (visited, x, y, width, height) => {
        rects.push({ id: visited.id, pitch: visited.pitch, x, y, width, height });
    });
    return rects;
};

describe('resolveMidiPitchWindow', () => {
    it('shows the octave from middle C for an empty inline clip', () => {
        const window = resolveMidiPitchWindow([], true, 76);

        expect(window).toMatchObject({ minPitch: 60, maxPitch: 71, pitchRange: 11 });
        expect(window.rowHeight).toBeCloseTo(76 / 12);
    });

    it('gives an empty clip the window a single middle C note gives', () => {
        expect(resolveMidiPitchWindow([], true, 76)).toEqual(resolveMidiPitchWindow([note('c', 60, 0, 1)], true, 76));
    });

    it('spans whole octaves from C that hold the lowest and the highest note', () => {
        const window = resolveMidiPitchWindow([note('a', 62, 0, 1), note('b', 75, 1, 1)], true, 76);

        expect(window).toMatchObject({ minPitch: 60, maxPitch: 83, pitchRange: 23 });
    });

    it('keeps a note on the top pitch of its octave inside that octave', () => {
        expect(resolveMidiPitchWindow([note('b', 71, 0, 1)], true, 76)).toMatchObject({ minPitch: 60, maxPitch: 71 });
        expect(resolveMidiPitchWindow([note('c', 72, 0, 1)], true, 76)).toMatchObject({ minPitch: 72, maxPitch: 83 });
    });

    it('stops the top octave at MIDI pitch 127', () => {
        const window = resolveMidiPitchWindow([note('a', 125, 0, 1)], true, 80);

        expect(window).toMatchObject({ minPitch: 120, maxPitch: 127, pitchRange: 7 });
        expect(window.rowHeight).toBe(10);
    });

    it('does not move the rows when a note is added inside the span', () => {
        const before = resolveMidiPitchWindow([note('a', 62, 0, 1), note('b', 75, 1, 1)], true, 76);
        const after = resolveMidiPitchWindow([note('a', 62, 0, 1), note('b', 75, 1, 1), note('c', 66, 2, 1)], true, 76);

        expect(after).toEqual(before);
    });

    it('uses the raw extent when not inline', () => {
        const window = resolveMidiPitchWindow([note('a', 60, 0, 1), note('b', 64, 1, 1)], false, 40);

        expect(window).toMatchObject({ minPitch: 60, maxPitch: 64, pitchRange: 4 });
    });
});

describe('resolveInlineNoteBeat', () => {
    const timing = (overrides: Partial<InlineMidiTimingClip> = {}): InlineMidiTimingClip => ({
        startBeat: 8.25,
        endBeat: 16.25,
        ...overrides,
    });

    it('measures from the clip start', () => {
        expect(resolveInlineNoteBeat(timing(), 9)).toBeCloseTo(0.75);
    });

    it('adds the content offset', () => {
        expect(resolveInlineNoteBeat(timing({ midiOffsetBeats: 0.25 }), 9)).toBeCloseTo(1);
    });

    it('folds a later loop pass back onto the source', () => {
        const clip = timing({ midiOffsetBeats: 1, loopEnabled: true, loopLength: 3 });

        // 12.75 is 4.5 beats into the clip, 1.5 into its second pass.
        expect(resolveInlineNoteBeat(clip, 12.75)).toBeCloseTo(2.5);
    });

    it('reads a loop boundary that division error leaves just short of it as the next pass start', () => {
        const clip = timing({ loopEnabled: true, loopLength: 0.1 });

        expect(0.3 % 0.1).toBeGreaterThan(0.09);
        expect(resolveInlineNoteBeat({ ...clip, startBeat: 0 }, 0.3)).toBeCloseTo(0);
    });

    it('reads a beat before the clip start as the clip start', () => {
        expect(resolveInlineNoteBeat(timing({ midiOffsetBeats: 0.5 }), 7)).toBeCloseTo(0.5);
    });
});

describe('inline MIDI geometry law', () => {
    it('draws a note at its clip-relative position, offset and loop repeats included', () => {
        const clip = offsetLoopedClip();
        const rects = collectRects(clip, frameFor(clip)).filter((rect) => rect.id === 'high');

        // relStart = startBeat - midiOffset + k * loopLength = 0.5, 3.5, 6.5 beats from the clip start.
        expect(rects.map((rect) => rect.x)).toEqual([
            (8 + 0.5) * PIXELS_PER_BEAT,
            (8 + 3.5) * PIXELS_PER_BEAT,
            (8 + 6.5) * PIXELS_PER_BEAT,
        ]);
    });

    it('agrees with its inverse: the centre of every drawn rectangle maps back to that note', () => {
        const clip = offsetLoopedClip();
        const frame = frameFor(clip);
        const rects = collectRects(clip, frame);
        expect(rects).toHaveLength(6);

        for (const rect of rects) {
            const source = clip.midiNotes.find((candidate) => candidate.id === rect.id)!;
            const pointer = resolveInlineMidiPointer(clip, frame, rect.x + rect.width / 2, rect.y + rect.height / 2);

            expect(pointer?.pitch).toBe(source.pitch);
            expect(pointer?.noteBeat).toBeGreaterThanOrEqual(source.startBeat);
            expect(pointer?.noteBeat).toBeLessThan(source.startBeat + source.duration);
            expect(findInlineMidiNoteAt(clip, frame, rect.x + rect.width / 2, rect.y + rect.height / 2)?.noteId).toBe(
                rect.id
            );
        }
    });

    it('does not find a note at the position its absolute beat would give', () => {
        const clip = offsetLoopedClip();
        const frame = frameFor(clip);
        const highRect = collectRects(clip, frame).find((rect) => rect.id === 'high')!;
        const absoluteX = 1.5 * PIXELS_PER_BEAT + 10;

        expect(findInlineMidiNoteAt(clip, frame, absoluteX, highRect.y + highRect.height / 2)).toBeNull();
    });

    it('folds a pointer in a later loop repeat back into the first pass of the source', () => {
        const clip = offsetLoopedClip();
        const frame = frameFor(clip);

        // 4.5 beats into the clip is 1.5 beats into the second 3-beat pass; add the 1-beat offset.
        const pointer = resolveInlineMidiPointer(clip, frame, frame.x + 4.5 * PIXELS_PER_BEAT, 40);

        expect(pointer?.noteBeat).toBeCloseTo(2.5);
    });

    it('adds the content offset without folding when the clip does not loop', () => {
        const clip: InlineMidiGeometryClip = { ...offsetLoopedClip(), loopEnabled: false };
        const frame = frameFor(clip);

        const pointer = resolveInlineMidiPointer(clip, frame, frame.x + 4.5 * PIXELS_PER_BEAT, 40);

        expect(pointer?.noteBeat).toBeCloseTo(5.5);
    });

    it('reads the pitch row under the pointer from the same window the notes are drawn in', () => {
        const clip: InlineMidiGeometryClip = {
            startBeat: 0,
            endBeat: 4,
            midiNotes: [note('mid', 60, 0, 1)],
        };
        const frame = frameFor(clip);
        const window = resolveMidiPitchWindow(clip.midiNotes, true, frame.contentHeight);

        // Top row is maxPitch (71); each row is rowHeight tall.
        const topRow = resolveInlineMidiPointer(clip, frame, 100, frame.contentTop + window.rowHeight * 0.5);
        const thirdRow = resolveInlineMidiPointer(clip, frame, 100, frame.contentTop + window.rowHeight * 2.5);
        const bottomRow = resolveInlineMidiPointer(clip, frame, 100, frame.contentTop + frame.contentHeight - 0.5);

        expect(topRow?.pitch).toBe(71);
        expect(thirdRow?.pitch).toBe(69);
        expect(bottomRow?.pitch).toBe(60);
    });

    it('gives an empty inline clip rows to hit', () => {
        const clip: InlineMidiGeometryClip = { startBeat: 0, endBeat: 4, midiNotes: [] };
        const frame = frameFor(clip);

        const pointer = resolveInlineMidiPointer(clip, frame, 100, frame.contentTop + frame.contentHeight / 2);

        // Row 6 of the 71..60 window.
        expect(pointer?.pitch).toBe(65);
    });

    it('reports no pitch outside the pitch rows', () => {
        const clip: InlineMidiGeometryClip = { startBeat: 0, endBeat: 4, midiNotes: [note('a', 60, 0, 1)] };
        const frame = frameFor(clip);

        expect(resolveInlineMidiPointer(clip, frame, 100, 1)?.pitch).toBeNull();
        expect(
            resolveInlineMidiPointer(clip, frame, 100, frame.contentTop + frame.contentHeight + 1)?.pitch
        ).toBeNull();
    });

    it('reports the arrangement beat under the pointer beside the source beat', () => {
        const clip = offsetLoopedClip();
        const frame = frameFor(clip);

        const pointer = resolveInlineMidiPointer(clip, frame, frame.x + 4.5 * PIXELS_PER_BEAT, 40);

        expect(pointer?.pointerBeat).toBeCloseTo(12.5);
    });

    it('yields nothing for a note area too short to be drawn', () => {
        const clip: InlineMidiGeometryClip = { startBeat: 0, endBeat: 4, midiNotes: [note('a', 60, 0, 1)] };

        expect(resolveInlineMidiPointer(clip, frameFor(clip, 2, 3), 100, 3)).toBeNull();
    });
});
