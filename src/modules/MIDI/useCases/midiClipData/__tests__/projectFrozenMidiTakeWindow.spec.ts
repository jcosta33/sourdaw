import { describe, expect, it } from 'vitest';

import { createMidiChannelControllerState } from '../../../models/MidiControllerState';
import { type MidiCC } from '../../../models/MidiNote';
import { applyRegisteredParameterChange } from '../../../services/applyRegisteredParameterChange';
import { type FrozenMidiTakeFragment } from '../../../stores/frozenMidiTakeRepeats';
import { isFrozenMidiTakeSource } from '../../../stores/isFrozenMidiTakeSource';
import { projectClipMidiEvents } from '../../grooveTemplates/projectClipMidiEvents';
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
    it('plays a pedal lift on the fragment’s closing line, never at an inner loop seam', () => {
        const original = source();
        const pedal = { id: 'press', controller: 64, value: 127, channel: 0, beat: 5 };
        const lift = { id: 'press-lift', controller: 64, value: 0, channel: 0, beat: 9 };
        const frozen = {
            ...original,
            rows: { ...original.rows, controlChanges: { present: true as const, value: [pedal, lift] } },
        };
        const project = (
            selectedSource: FrozenMidiTakeSource,
            fragment: FrozenMidiTakeFragment,
            absoluteOccurrenceIndex: number
        ) =>
            projectFrozenMidiTakeWindow({
                source: selectedSource,
                fragment,
                absoluteOccurrenceIndex,
                fromBeat: fragment.startBeat,
                toBeat: fragment.endBeat,
            });
        const looping = { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 };

        expect(project(frozen, looping, 0)?.closingControlChanges).toEqual([]);
        expect(project(frozen, looping, 1)?.closingControlChanges).toEqual([{ ...lift, beat: 8 }]);
        expect(project(frozen, { startBeat: 0, endBeat: 4 }, 0)?.closingControlChanges).toEqual([{ ...lift, beat: 4 }]);

        const shortPass = {
            ...frozen,
            sourceEndBeat: 8,
            rows: {
                ...frozen.rows,
                controlChanges: { present: true as const, value: [pedal, { ...lift, beat: 8 }] },
            },
        };
        expect(project(shortPass, { startBeat: 0, endBeat: 3 }, 0)?.closingControlChanges).toEqual([
            { ...lift, beat: 3 },
        ]);
    });

    it('locates the last own bend before a crop without changing original scalar or curve rows', () => {
        const original = source();
        const notes = [
            {
                id: 'scalar',
                pitch: 60,
                startBeat: 5,
                duration: 3,
                velocity: 100,
                pitchBend: 1000,
                expression: { pitchBend: [{ offsetBeats: 0.25, value: 2000 }] },
            },
            {
                id: 'later-point',
                pitch: 62,
                startBeat: 5,
                duration: 3,
                velocity: 100,
                pitchBend: 1000,
                expression: { pitchBend: [{ offsetBeats: 0.75, value: 3000 }] },
            },
        ];
        const frozen = {
            ...original,
            sourceEntryBeat: 4,
            sourceEndBeat: 8,
            rows: { ...original.rows, notes: { present: true as const, value: notes } },
        };
        const before = structuredClone(frozen);

        const window = projectFrozenMidiTakeWindow({
            source: frozen,
            fragment: { startBeat: 0, endBeat: 4 },
            absoluteOccurrenceIndex: 0,
            fromBeat: 2,
            toBeat: 4,
        });

        expect(
            window?.notes.map(({ id, startBeat, pitchBend, recordedOwnBendBeat }) => ({
                id,
                startBeat,
                pitchBend,
                recordedOwnBendBeat,
            }))
        ).toEqual([
            { id: 'scalar', startBeat: 2, pitchBend: 2000, recordedOwnBendBeat: 1.25 },
            { id: 'later-point', startBeat: 2, pitchBend: 3000, recordedOwnBendBeat: 1.75 },
        ]);
        expect(frozen).toEqual(before);
    });

    it('retains a carried bend’s original source beat through full, partial and repeated windows', () => {
        const original = source();
        const controls = [
            { id: 'rpn-msb', controller: 101, value: 0, channel: 0, beat: 0 },
            { id: 'rpn-lsb', controller: 100, value: 0, channel: 0, beat: 0 },
            { id: 'range-12', controller: 6, value: 12, channel: 0, beat: 0 },
            { id: 'range-24', controller: 6, value: 24, channel: 0, beat: 3 },
        ];
        const frozen = {
            ...original,
            sourceEntryBeat: 4,
            sourceEndBeat: 8,
            rows: {
                ...original.rows,
                controlChanges: { present: true as const, value: controls },
                pitchBends: {
                    present: true as const,
                    value: [
                        { id: 'carried', value: 8191, channel: 0, beat: 2 },
                        { id: 'later', value: 4096, channel: 0, beat: 5 },
                    ],
                },
            },
        };
        const beforeProjection = structuredClone(frozen);
        const project = (absoluteOccurrenceIndex: number, fromBeat: number, toBeat: number) =>
            projectFrozenMidiTakeWindow({
                source: frozen,
                fragment: { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 },
                absoluteOccurrenceIndex,
                fromBeat,
                toBeat,
            });
        const sourceBeats = (window: NonNullable<ReturnType<typeof project>>) =>
            window.pitchBends.map(({ id, beat, sourceRecordedBeat }) => [id, beat, sourceRecordedBeat]);

        const first = project(0, 0, 4);
        const partial = project(0, 0.5, 4);
        const repeated = project(1, 4, 8);

        expect(first).not.toBeNull();
        expect(partial).not.toBeNull();
        expect(repeated).not.toBeNull();
        expect(sourceBeats(first!)).toEqual([
            ['carried', 0, 2],
            ['later', 1, 5],
        ]);
        expect(sourceBeats(partial!)).toEqual([
            ['carried', 0.5, 2],
            ['later', 1, 5],
        ]);
        expect(sourceBeats(repeated!)).toEqual([
            ['carried', 4, 2],
            ['later', 5, 5],
        ]);
        expect(createStoredBendRangeReader(first!.controlChanges)(0, 0)).toBe(24);
        expect(createStoredBendRangeReader(controls)(0, 2)).toBe(12);
        expect(frozen).toEqual(beforeProjection);
    });

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
            fragment: { startBeat: 0, endBeat: 4 },
            absoluteOccurrenceIndex: 0,
            fromBeat: 0,
            toBeat: 4,
        });
        const right = projectFrozenMidiTakeWindow({
            source: frozen,
            fragment: { startBeat: 0, endBeat: 4 },
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

    it('keeps original row ids, occurrence and controller state through the repeats of a looping fragment', () => {
        const original = source();
        const fragment = { startBeat: 0, endBeat: 12, loopEnabled: true, loopLength: 4 };
        const first = projectFrozenMidiTakeWindow({
            source: original,
            fragment,
            absoluteOccurrenceIndex: 0,
            fromBeat: 0,
            toBeat: 2,
        });
        const rightFirst = projectFrozenMidiTakeWindow({
            source: original,
            fragment,
            absoluteOccurrenceIndex: 0,
            fromBeat: 2,
            toBeat: 4,
        });
        const rightSecond = projectFrozenMidiTakeWindow({
            source: original,
            fragment,
            absoluteOccurrenceIndex: 1,
            fromBeat: 2,
            toBeat: 8,
        });
        const partialThird = projectFrozenMidiTakeWindow({
            source: original,
            fragment,
            absoluteOccurrenceIndex: 2,
            fromBeat: 8,
            toBeat: 9,
        });

        // The seam note crosses the loop end, so its tail wraps onto every repeat's start, as live loops it;
        // the other pass's note lies past the loop end and never sounds.
        expect(first?.notes.map((note) => [note.id, note.startBeat, note.duration])).toEqual([
            ['seam', 0, 0.75],
            ['selected', 0.5, 1],
        ]);
        expect(rightFirst?.notes.map((note) => [note.id, note.startBeat, note.duration])).toEqual([
            ['seam', 3.75, 0.25],
        ]);
        expect(rightSecond?.notes.map((note) => [note.id, note.startBeat, note.duration])).toEqual([
            ['seam', 4, 0.75],
            ['selected', 4.5, 1],
            ['seam', 7.75, 0.25],
        ]);
        expect(partialThird?.notes.map((note) => [note.id, note.startBeat])).toEqual([
            ['seam', 8],
            ['selected', 8.5],
        ]);
        expect(rightSecond?.controlChanges.map((row) => [row.id, row.beat])).toEqual([['pedal', 4]]);
        expect(rightSecond?.pitchBends.map((row) => [row.id, row.beat])).toEqual([['bend', 4]]);
        expect(rightSecond?.sourceClipId).toBe('original');
        expect(rightSecond?.absoluteOccurrenceIndex).toBe(1);
    });

    it('shifts phase with Delete Time and preserves the source occurrence', () => {
        const moved = { ...source(), phaseHeadBeat: -2 };
        const projected = projectFrozenMidiTakeWindow({
            source: moved,
            fragment: { startBeat: -2, endBeat: 6, loopEnabled: true, loopLength: 4 },
            absoluteOccurrenceIndex: 1,
            fromBeat: 2,
            toBeat: 6,
        });
        expect(projected?.notes.map((note) => [note.id, note.startBeat])).toEqual([
            ['seam', 2],
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
            fragment: { startBeat: 0, endBeat: 4 },
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
            projectFrozenMidiTakeWindow({
                source: empty,
                fragment: { startBeat: 0, endBeat: 8, loopEnabled: true, loopLength: 4 },
                absoluteOccurrenceIndex: 1,
                fromBeat: 4,
                toBeat: 8,
            })?.notes
        ).toEqual([]);

        const malformed = { ...source(), rows: { notes: { present: true, value: [] } } };
        expect(isFrozenMidiTakeSource(malformed)).toBe(false);
    });
});

describe('frozen MIDI take run-up', () => {
    /**
     * A loop take recorded from 6 in loop [8, 12): pass 0 reads source 2 at 8,
     * pass 1 reads source 6 at 8. Live comp playback plays a pass take from
     * its clip's start at 6, so a comp from there reads the stretch before
     * each take's own entry.
     */
    const runUpRows: FrozenMidiTakeSource['rows'] = {
        notes: {
            present: true,
            value: [
                {
                    id: 'pass-0-run-up',
                    pitch: 60,
                    startBeat: 0.5,
                    duration: 0.25,
                    velocity: 100,
                    recordingPassIndex: 0,
                },
                { id: 'pass-0-late', pitch: 61, startBeat: 4.5, duration: 0.25, velocity: 100, recordingPassIndex: 0 },
                { id: 'untagged', pitch: 62, startBeat: 5, duration: 0.25, velocity: 100 },
                { id: 'pass-1', pitch: 63, startBeat: 6.5, duration: 0.25, velocity: 100, recordingPassIndex: 1 },
                { id: 'untagged-late', pitch: 64, startBeat: 7.5, duration: 0.25, velocity: 100 },
            ],
        },
        controlChanges: {
            present: true,
            value: [{ id: 'swell', controller: 1, value: 90, channel: 0, beat: 5.5 }],
        },
        pitchBends: { present: true, value: [] },
    };
    const firstPass: FrozenMidiTakeSource = {
        sourceClipId: 'original',
        rows: runUpRows,
        sourceEntryBeat: 2,
        sourceEndBeat: 6,
        phaseHeadBeat: 8,
        passLengthBeats: 4,
    };
    const secondPass: FrozenMidiTakeSource = { ...firstPass, sourceEntryBeat: 6, sourceEndBeat: 10 };

    function heard(
        source: FrozenMidiTakeSource,
        recordingPassIndex: number,
        fragment: FrozenMidiTakeFragment,
        absoluteOccurrenceIndex = 0
    ) {
        const window = projectFrozenMidiTakeWindow({
            source,
            fragment,
            recordingPassIndex,
            absoluteOccurrenceIndex,
            fromBeat: fragment.startBeat,
            toBeat: fragment.endBeat,
        });
        return {
            notes: window?.notes.map((note) => [note.id, note.startBeat]),
            controlChanges: window?.controlChanges.map((row) => [row.id, row.beat]),
        };
    }

    it('plays the first pass from the clip start, its run-up included', () => {
        expect(heard(firstPass, 0, { startBeat: 6, endBeat: 12 }).notes).toEqual([
            ['pass-0-run-up', 6.5],
            ['pass-0-late', 10.5],
            ['untagged', 11],
        ]);
        expect(heard(firstPass, 0, { startBeat: 6, endBeat: 8 }).notes).toEqual([['pass-0-run-up', 6.5]]);
    });

    it('plays a later pass from the clip start as live does: earlier passes filtered, untagged rows and controllers kept', () => {
        expect(heard(secondPass, 1, { startBeat: 6, endBeat: 12 })).toEqual({
            notes: [
                ['untagged', 7],
                ['pass-1', 8.5],
                ['untagged-late', 9.5],
            ],
            controlChanges: [['swell', 7.5]],
        });
    });

    it('reads straight through past the pass end when the fragment does not loop', () => {
        expect(heard(firstPass, 0, { startBeat: 6, endBeat: 16 }).notes).toEqual([
            ['pass-0-run-up', 6.5],
            ['pass-0-late', 10.5],
            ['untagged', 11],
            ['untagged-late', 13.5],
        ]);
    });

    it('restarts every repeat of a looping fragment at its own start, as live does', () => {
        const looping = { startBeat: 6, endBeat: 14, loopEnabled: true, loopLength: 4 };
        expect(heard(firstPass, 0, looping, 0).notes).toEqual([['pass-0-run-up', 6.5]]);
        expect(heard(firstPass, 0, looping, 1).notes).toEqual([['pass-0-run-up', 10.5]]);
    });
});

describe('frozen MIDI take in a looping comp fragment', () => {
    /** Pass 0's take reads source 2 at 8; a note crosses the loop end and one lies past it. */
    const pass: FrozenMidiTakeSource = {
        sourceClipId: 'original',
        sourceEntryBeat: 2,
        sourceEndBeat: 6,
        phaseHeadBeat: 8,
        passLengthBeats: 4,
        rows: {
            notes: {
                present: true,
                value: [
                    { id: 'a', pitch: 60, startBeat: 0.5, duration: 0.25, velocity: 100 },
                    { id: 'b', pitch: 61, startBeat: 2.5, duration: 0.5, velocity: 100 },
                    { id: 'c', pitch: 62, startBeat: 3.75, duration: 1, velocity: 100 },
                    { id: 'd', pitch: 63, startBeat: 5.25, duration: 0.25, velocity: 100 },
                    { id: 'e', pitch: 64, startBeat: 6.75, duration: 1, velocity: 100 },
                    { id: 'f', pitch: 65, startBeat: 7.75, duration: 0.25, velocity: 100 },
                ],
            },
            controlChanges: { present: false, value: [] },
            pitchBends: { present: false, value: [] },
        },
    };
    /** A comp region starting mid-pass, over two loop lengths. */
    const fragment = { startBeat: 9.5, endBeat: 17.5, loopEnabled: true, loopLength: 4 };

    function segments(notes: readonly { id: string; startBeat: number; duration: number }[]) {
        return notes
            .map((note) => [note.id, note.startBeat, note.duration] as const)
            .toSorted((first, second) => first[1] - second[1] || first[0].localeCompare(second[0]));
    }

    function frozenSegments(source: FrozenMidiTakeSource) {
        return segments(
            [0, 1].flatMap(
                (absoluteOccurrenceIndex) =>
                    projectFrozenMidiTakeWindow({
                        source,
                        fragment,
                        absoluteOccurrenceIndex,
                        fromBeat: fragment.startBeat,
                        toBeat: fragment.endBeat,
                    })?.notes ?? []
            )
        );
    }

    /** What the live comp fragment plays: the same rows, entered at the media offset of the fragment start. */
    function liveSegments() {
        const midiOffsetBeats = pass.sourceEntryBeat + fragment.startBeat - pass.phaseHeadBeat;
        return segments(
            [0, 1].flatMap((iteration) =>
                projectClipMidiEvents({
                    events: pass.rows.notes.value,
                    clipId: 'live',
                    clipStartBeat: fragment.startBeat,
                    clipEndBeat: fragment.endBeat,
                    iterationStartBeat: fragment.startBeat + iteration * fragment.loopLength,
                    loopLengthBeats: fragment.loopLength,
                    midiOffsetBeats,
                    loopEnabled: true,
                })
            )
        );
    }

    it('plays what the live comp fragment plays over two repeats: folded earlier notes, a wrapped tail, nothing past the loop end', () => {
        const live = liveSegments();
        expect(live).toEqual([
            ['e', 9.5, 0.25],
            ['c', 9.75, 1],
            ['a', 10.5, 0.25],
            ['d', 11.25, 0.25],
            ['b', 12.5, 0.5],
            ['e', 12.75, 0.75],
            ['e', 13.5, 0.25],
            ['c', 13.75, 1],
            ['a', 14.5, 0.25],
            ['d', 15.25, 0.25],
            ['b', 16.5, 0.5],
            ['e', 16.75, 0.75],
        ]);
        expect(frozenSegments(pass)).toEqual(live);
    });

    it('reads nothing a Delete Time cut off the source, folded or wrapped', () => {
        expect(frozenSegments({ ...pass, readStartBeat: 3, readEndBeat: 7 })).toEqual([
            ['c', 9.75, 1],
            ['d', 11.25, 0.25],
            ['e', 12.75, 0.25],
            ['c', 13.75, 1],
            ['d', 15.25, 0.25],
            ['e', 16.75, 0.25],
        ]);
    });
});
