import { describe, expect, it } from 'vitest';

import { type MidiClipDataActionSnapshot } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { createTake } from '../../../models/TakeLane';
import { type TempoTimeline } from '../../../models/TempoTimeline';
import { prepareMidiTakeSourceCapture } from '../prepareMidiTakeSourceCapture';
import { relocateMidiTakeSource } from '../relocateMidiTakeSource';

const timeline: TempoTimeline = {
    secondsAtBeat: (beat) => beat / 2,
    beatAtSeconds: (seconds) => seconds * 2,
    tempoAtBeat: () => 120,
};

const rows: MidiClipDataActionSnapshot = {
    notes: {
        present: true,
        value: [{ id: 'note', pitch: 60, startBeat: 5.5, duration: 1, velocity: 100 }],
    },
    controlChanges: { present: false, value: [] },
    pitchBends: { present: true, value: [] },
};

describe('prepare MIDI take source capture', () => {
    it('keeps the source interval and original loop period before ordinary split partitioning', () => {
        const clip = ClipDummy.create({
            id: 'source',
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
            midiOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 4,
        });
        const take = createTake('source', 'Second pass', 0, 8, 4);
        const capture = prepareMidiTakeSourceCapture({ clip, take, siblingTakes: [take], rows, timeline });

        expect(capture).toEqual({
            sourceClipId: 'source',
            rows,
            sourceEntryBeat: 5,
            sourceEndBeat: 9,
            phaseHeadBeat: 0,
            passLengthBeats: 4,
        });
        expect(capture?.rows).not.toBe(rows);
        expect(capture?.rows.controlChanges).toEqual({ present: false, value: [] });
        expect(capture?.rows.pitchBends).toEqual({ present: true, value: [] });
    });

    it('captures the second pass and its pedal and bend rows for playback', () => {
        const clip = ClipDummy.create({
            id: 'source',
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
            loopEnabled: true,
            loopLength: 4,
        });
        const take = { ...createTake('source', 'Second pass', 0, 4, 4), recordingPassIndex: 1 };
        const capturedRows: MidiClipDataActionSnapshot = {
            notes: {
                present: true,
                value: [
                    {
                        id: 'selected',
                        pitch: 60,
                        startBeat: 5,
                        duration: 3,
                        velocity: 100,
                        pitchBend: 1000,
                        recordingPassIndex: 1,
                    },
                ],
            },
            controlChanges: {
                present: true,
                value: [
                    { id: 'press', controller: 64, value: 127, beat: 4, channel: 0 },
                    { id: 'lift', controller: 64, value: 0, beat: 8, channel: 0 },
                ],
            },
            pitchBends: { present: true, value: [{ id: 'later', beat: 5.5, value: 8191, channel: 0 }] },
        };
        expect(
            prepareMidiTakeSourceCapture({ clip, take, siblingTakes: [take], rows: capturedRows, timeline })
        ).toEqual({
            sourceClipId: 'source',
            rows: capturedRows,
            sourceEntryBeat: 4,
            sourceEndBeat: 8,
            phaseHeadBeat: 0,
            passLengthBeats: 4,
        });
    });

    it('uses a full sibling pass period for a short first pass begun inside the loop', () => {
        const clip = ClipDummy.create({ id: 'source', type: 'midi', startBeat: 2, endBeat: 8 });
        const first = createTake('source', 'First pass', 2, 4, 0);
        const second = createTake('source', 'Second pass', 0, 4, 2);
        const capture = prepareMidiTakeSourceCapture({
            clip,
            take: first,
            siblingTakes: [first, second],
            rows,
            timeline,
        });

        expect(capture).toMatchObject({
            sourceEntryBeat: 0,
            sourceEndBeat: 2,
            phaseHeadBeat: 2,
            passLengthBeats: 4,
        });
    });

    it('strides every pass of a recording begun before the loop by the loop length', () => {
        // Recorded from 6 in loop [8, 12): the first pass keeps its loop window at depth 0, the second sits a loop deeper.
        const clip = ClipDummy.create({ id: 'source', type: 'midi', startBeat: 6, endBeat: 16 });
        const first = { ...createTake('source', 'First pass', 8, 12, 0), recordingPassIndex: 0 };
        const second = { ...createTake('source', 'Second pass', 8, 12, 4), recordingPassIndex: 1 };
        const siblingTakes = [first, second];

        expect(prepareMidiTakeSourceCapture({ clip, take: first, siblingTakes, rows, timeline })).toMatchObject({
            sourceEntryBeat: 2,
            sourceEndBeat: 6,
            phaseHeadBeat: 8,
            passLengthBeats: 4,
        });
        expect(prepareMidiTakeSourceCapture({ clip, take: second, siblingTakes, rows, timeline })).toMatchObject({
            sourceEntryBeat: 6,
            sourceEndBeat: 10,
            phaseHeadBeat: 8,
            passLengthBeats: 4,
        });
    });

    it('accepts a negative source entry and refuses an incomplete present snapshot', () => {
        const clip = ClipDummy.create({
            id: 'source',
            type: 'midi',
            startBeat: 0,
            endBeat: 4,
            midiOffsetBeats: -1,
        });
        const take = createTake('source', 'Negative source', 0, 4);
        expect(
            prepareMidiTakeSourceCapture({ clip, take, siblingTakes: [take], rows, timeline })?.sourceEntryBeat
        ).toBe(-1);
        const malformed: MidiClipDataActionSnapshot = {
            ...rows,
            controlChanges: {
                present: false,
                value: [{ id: 'stale', controller: 64, value: 127, beat: 0, channel: 0 }],
            },
        };
        expect(
            prepareMidiTakeSourceCapture({ clip, take, siblingTakes: [take], rows: malformed, timeline })
        ).toBeNull();
    });

    it('keeps source rows across a split and composes a later Delete Time phase move', () => {
        const clip = ClipDummy.create({
            id: 'source',
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
            midiOffsetBeats: 1,
            loopEnabled: true,
            loopLength: 4,
        });
        const take = createTake('source', 'Second pass', 0, 8, 4);
        const captured = prepareMidiTakeSourceCapture({ clip, take, siblingTakes: [take], rows, timeline });
        expect(captured).not.toBeNull();
        if (!captured) {
            return;
        }
        const rightSplit = relocateMidiTakeSource(captured, 2, 2);
        expect(rightSplit).toEqual(captured);
        if (!rightSplit) {
            return;
        }
        const afterDelete = relocateMidiTakeSource(rightSplit, 4, 2);
        expect(afterDelete?.sourceEntryBeat).toBe(5);
        expect(afterDelete?.rows).toEqual(rows);
        expect(afterDelete?.phaseHeadBeat).toBe(-2);
    });
});
