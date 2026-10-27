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
