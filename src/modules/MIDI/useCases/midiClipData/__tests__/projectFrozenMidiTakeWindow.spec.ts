import { describe, expect, it } from 'vitest';

import { createMidiChannelControllerState } from '../../../models/MidiControllerState';
import { type MidiCC } from '../../../models/MidiNote';
import { applyRegisteredParameterChange } from '../../../services/applyRegisteredParameterChange';
import { isFrozenMidiTakeSource } from '../../../stores/isFrozenMidiTakeSource';
import { createStoredBendRangeReader } from '../createStoredBendRangeReader';
import { type FrozenMidiTakeSource, projectFrozenMidiTakeWindow } from '../projectFrozenMidiTakeWindow';

function registeredStateAt(rows: readonly MidiCC[], beat: number, channel: number) {
    const state = createMidiChannelControllerState();
    for (const row of rows.toSorted((first, second) => first.beat - second.beat)) {
        if (row.channel === channel && row.beat <= beat) {
            applyRegisteredParameterChange(state, row.controller, row.value);
        }
    }
    return state;
}

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
                    { id: 'selected', pitch: 60, startBeat: 5.5, duration: 1, velocity: 100 },
                    { id: 'seam', pitch: 64, startBeat: 8.75, duration: 1, velocity: 100 },
                    { id: 'other-pass', pitch: 72, startBeat: 9.5, duration: 1, velocity: 100 },
                ],
            },
            controlChanges: {
                present: true,
                value: [{ id: 'pedal', controller: 64, value: 127, channel: 0, beat: 4.8 }],
            },
            pitchBends: {
                present: true,
                value: [{ id: 'bend', value: 2048, channel: 0, beat: 4.9 }],
            },
        },
    };
}

describe('frozen MIDI take window', () => {
    it('declares each channel’s complete pre-window parameter state without changing ordinary carries or source rows', () => {
        const original = source();
        const controls: MidiCC[] = [
            { id: 'select-0-msb', controller: 101, value: 0, channel: 0, beat: 4 },
            { id: 'select-0-lsb', controller: 100, value: 0, channel: 0, beat: 4 },
            { id: 'range-0', controller: 6, value: 12, channel: 0, beat: 4 },
            { id: 'cents-0', controller: 38, value: 0, channel: 0, beat: 4 },
            { id: 'null-0-msb', controller: 101, value: 127, channel: 0, beat: 4 },
            { id: 'null-0-lsb', controller: 100, value: 127, channel: 0, beat: 4 },
            { id: 'select-1-msb', controller: 101, value: 0, channel: 1, beat: 4.25 },
            { id: 'select-1-lsb', controller: 100, value: 0, channel: 1, beat: 4.25 },
            { id: 'range-1', controller: 6, value: 7, channel: 1, beat: 4.25 },
            { id: 'pedal', controller: 64, value: 127, channel: 0, beat: 4.75 },
            { id: 'select-later-msb', controller: 101, value: 0, channel: 0, beat: 5.5 },
            { id: 'select-later-lsb', controller: 100, value: 0, channel: 0, beat: 5.5 },
            { id: 'range-later', controller: 6, value: 24, channel: 0, beat: 5.5 },
        ];
        const frozen = {
            ...original,
            rows: { ...original.rows, controlChanges: { present: true as const, value: controls } },
        };
        const beforeProjection = structuredClone(frozen);
        const first = projectFrozenMidiTakeWindow({
            source: frozen,
            absoluteOccurrenceIndex: 0,
            fromBeat: 0,
            toBeat: 4,
        });
        const right = projectFrozenMidiTakeWindow({
            source: frozen,
            absoluteOccurrenceIndex: 0,
            fromBeat: 1,
            toBeat: 4,
        });

        expect(first).not.toBeNull();
        expect(right).not.toBeNull();
        expect(first!.controlChanges.find((row) => row.id === 'pedal')).toMatchObject({ beat: 0, value: 127 });
        expect(first!.controlChanges.filter((row) => row.id === 'range-later')).toEqual([
            { id: 'range-later', controller: 6, value: 24, channel: 0, beat: 0.5 },
        ]);
        expect(registeredStateAt(first!.controlChanges, 0, 0)).toEqual(registeredStateAt(controls, 5, 0));
        expect(registeredStateAt(first!.controlChanges, 0, 1)).toEqual(registeredStateAt(controls, 5, 1));
        expect(registeredStateAt(first!.controlChanges, 0.5, 0)).toEqual(registeredStateAt(controls, 5.5, 0));
        expect(createStoredBendRangeReader(first!.controlChanges)(0, 0.25)).toBe(12);
        expect(createStoredBendRangeReader(first!.controlChanges)(0, 0.5)).toBe(24);
        expect(createStoredBendRangeReader(first!.controlChanges)(1, 0.5)).toBe(7);
        expect(createStoredBendRangeReader(first!.controlChanges)(2, 0.5)).toBe(2);
        expect(createStoredBendRangeReader(right!.controlChanges)(0, 1)).toBe(24);
        expect(frozen).toEqual(beforeProjection);
    });

    it('keeps original row ids, occurrence and controller state through right fragment windows', () => {
        const original = source();
        const first = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 0,
            fromBeat: 0,
            toBeat: 2,
        });
        const rightFirst = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 0,
            fromBeat: 2,
            toBeat: 4,
        });
        const rightSecond = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 1,
            fromBeat: 2,
            toBeat: 8,
        });
        const partialThird = projectFrozenMidiTakeWindow({
            source: original,
            absoluteOccurrenceIndex: 2,
            fromBeat: 8,
            toBeat: 9,
        });

        expect(first?.notes.map((note) => [note.id, note.startBeat])).toEqual([['selected', 0.5]]);
        expect(rightFirst?.notes.map((note) => [note.id, note.startBeat, note.duration])).toEqual([
            ['seam', 3.75, 0.25],
        ]);
        expect(rightSecond?.notes.map((note) => [note.id, note.startBeat, note.duration])).toEqual([
            ['selected', 4.5, 1],
            ['seam', 7.75, 0.25],
        ]);
        expect(partialThird?.notes.map((note) => [note.id, note.startBeat])).toEqual([['selected', 8.5]]);
        expect(rightSecond?.controlChanges.map((row) => [row.id, row.beat])).toEqual([['pedal', 4]]);
        expect(rightSecond?.pitchBends.map((row) => [row.id, row.beat])).toEqual([['bend', 4]]);
        expect(rightSecond?.sourceClipId).toBe('original');
        expect(rightSecond?.absoluteOccurrenceIndex).toBe(1);
    });

    it('shifts phase with Delete Time and preserves the source occurrence', () => {
        const moved = { ...source(), phaseHeadBeat: -2 };
        const projected = projectFrozenMidiTakeWindow({
            source: moved,
            absoluteOccurrenceIndex: 1,
            fromBeat: 2,
            toBeat: 6,
        });
        expect(projected?.notes.map((note) => [note.id, note.startBeat])).toEqual([
            ['selected', 2.5],
            ['seam', 5.75],
        ]);
        expect(projected?.absoluteOccurrenceIndex).toBe(1);
    });

    it('does not retrigger a held previous-pass note in the selected later pass', () => {
        const selected = {
            ...source(),
            sourceEntryBeat: 9,
            sourceEndBeat: 13,
            rows: {
                ...source().rows,
                notes: {
                    present: true as const,
                    value: [
                        {
                            id: 'held-previous',
                            pitch: 60,
                            startBeat: 8.75,
                            duration: 1,
                            velocity: 100,
                            recordingPassIndex: 0,
                        },
                        {
                            id: 'selected-onset',
                            pitch: 64,
                            startBeat: 9.5,
                            duration: 1,
                            velocity: 100,
                            recordingPassIndex: 1,
                        },
                    ],
                },
            },
        };
        const projected = projectFrozenMidiTakeWindow({
            source: selected,
            recordingPassIndex: 1,
            absoluteOccurrenceIndex: 0,
            fromBeat: 0,
            toBeat: 4,
        });
        expect(projected?.notes.map((note) => [note.id, note.recordingPassIndex, note.startBeat])).toEqual([
            ['selected-onset', 1, 0.5],
        ]);
    });

    it('treats present empty rows as empty and refuses a partial modern capture', () => {
        const original = source();
        const empty = { ...original, rows: { ...original.rows, notes: { present: true, value: [] } } };
        expect(
            projectFrozenMidiTakeWindow({ source: empty, absoluteOccurrenceIndex: 1, fromBeat: 4, toBeat: 8 })?.notes
        ).toEqual([]);

        const malformed = { ...source(), rows: { notes: { present: true, value: [] } } };
        expect(isFrozenMidiTakeSource(malformed)).toBe(false);
    });
});
