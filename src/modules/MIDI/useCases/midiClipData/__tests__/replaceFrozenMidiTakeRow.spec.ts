import { describe, expect, it } from 'vitest';

import { type FrozenMidiTakeSource } from '../projectFrozenMidiTakeWindow';
import { replaceFrozenMidiTakeRow } from '../replaceFrozenMidiTakeRow';

function source(): FrozenMidiTakeSource {
    return {
        sourceClipId: 'original',
        sourceEntryBeat: 5,
        sourceEndBeat: 9,
        phaseHeadBeat: 0,
        passLengthBeats: 4,
        rows: {
            notes: {
                present: true,
                value: [
                    { id: 'edited', pitch: 60, startBeat: 5.5, duration: 1, velocity: 100 },
                    { id: 'peer', pitch: 62, startBeat: 6.5, duration: 1, velocity: 110 },
                ],
            },
            controlChanges: {
                present: true,
                value: [{ id: 'pedal', controller: 64, value: 127, channel: 0, beat: 5 }],
            },
            pitchBends: {
                present: true,
                value: [{ id: 'bend', value: 2048, channel: 0, beat: 5 }],
            },
        },
    };
}

describe('frozen MIDI take row replacement', () => {
    it('edits and undoes one row while retaining a peer-edited sibling and row identities', () => {
        const captured = source();
        const original = captured.rows.notes.value[0]!;
        const edited = { ...original, startBeat: 5.75, velocity: 90 };
        const peerChanged: FrozenMidiTakeSource = {
            ...captured,
            rows: {
                ...captured.rows,
                notes: {
                    present: true,
                    value: [original, { ...captured.rows.notes.value[1]!, velocity: 71 }],
                },
            },
        };

        const after = replaceFrozenMidiTakeRow(peerChanged, { kind: 'note', expected: original, replacement: edited });
        expect(after?.rows.notes.value.map((row) => [row.id, row.velocity])).toEqual([
            ['edited', 90],
            ['peer', 71],
        ]);
        expect(after?.rows.controlChanges).toEqual(captured.rows.controlChanges);
        if (!after) {
            return;
        }
        const undone = replaceFrozenMidiTakeRow(after, { kind: 'note', expected: edited, replacement: original });
        expect(undone?.rows.notes.value.map((row) => [row.id, row.velocity])).toEqual([
            ['edited', 100],
            ['peer', 71],
        ]);
    });

    it('refuses a stale target, invalid row, or write into an absent slot', () => {
        const captured = source();
        const original = captured.rows.notes.value[0]!;
        expect(
            replaceFrozenMidiTakeRow(captured, {
                kind: 'note',
                expected: { ...original, velocity: 1 },
                replacement: { ...original, velocity: 90 },
            })
        ).toBeNull();
        expect(
            replaceFrozenMidiTakeRow(captured, {
                kind: 'note',
                expected: original,
                replacement: { ...original, startBeat: Number.NaN },
            })
        ).toBeNull();
        const noCc: FrozenMidiTakeSource = {
            ...captured,
            rows: { ...captured.rows, controlChanges: { present: false, value: [] } },
        };
        const controller = captured.rows.controlChanges.value[0]!;
        expect(
            replaceFrozenMidiTakeRow(noCc, {
                kind: 'cc',
                expected: controller,
                replacement: { ...controller, value: 0 },
            })
        ).toBeNull();
    });

    it('keeps controller and bend edits in their own slots', () => {
        const captured = source();
        const controller = captured.rows.controlChanges.value[0]!;
        const afterController = replaceFrozenMidiTakeRow(captured, {
            kind: 'cc',
            expected: controller,
            replacement: { ...controller, value: 0 },
        });
        expect(afterController?.rows.controlChanges.value[0]?.value).toBe(0);
        expect(afterController?.rows.notes).toEqual(captured.rows.notes);
        if (!afterController) {
            return;
        }
        const bend = afterController.rows.pitchBends.value[0]!;
        const afterBend = replaceFrozenMidiTakeRow(afterController, {
            kind: 'bend',
            expected: bend,
            replacement: { ...bend, value: -2048 },
        });
        expect(afterBend?.rows.pitchBends.value[0]?.value).toBe(-2048);
        expect(afterBend?.rows.controlChanges.value[0]?.value).toBe(0);
    });
});
