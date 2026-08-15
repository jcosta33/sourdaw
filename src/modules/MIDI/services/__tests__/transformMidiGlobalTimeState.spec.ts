import { describe, expect, it } from 'vitest';

import { transformMidiGlobalTimeState } from '../transformMidiGlobalTimeState';

import type { MidiStoreState } from '../../stores/midiStore';

function state(overrides: Partial<MidiStoreState> = {}): MidiStoreState {
    return {
        probabilitySeed: 23,
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
        ...overrides,
    };
}

const straddler = {
    clipId: 'source',
    eligible: true,
    startBeat: 0,
    endBeat: 12,
    midiOffsetBeats: 0,
};

describe('transformMidiGlobalTimeState', () => {
    it('shifts notes, CC, and pitch bend with D2 structural sharing', () => {
        const beforeNote = { id: 'before', pitch: 60, startBeat: 2, duration: 1, velocity: 90 };
        const shiftedNote = { id: 'shift', pitch: 64, startBeat: 5, duration: 1, velocity: 91 };
        const dormantNotes = [{ id: 'dormant', pitch: 50, startBeat: 5, duration: 1, velocity: 80 }];
        const prepared = state({
            notesByClipId: { source: [beforeNote, shiftedNote], dormant: dormantNotes },
            ccByClipId: { source: [{ id: 'cc', controller: 1, value: 64, beat: 5, channel: 1 }] },
            pitchBendByClipId: { source: [{ id: 'pb', value: 0.5, beat: 5, channel: 1 }] },
        });

        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'shift',
                    atBeat: 4,
                    beatDelta: 2,
                    clips: [straddler, { ...straddler, clipId: 'dormant', eligible: false }],
                },
            ],
            targetNoteIds: [],
        });

        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(true);
        expect(result.state.notesByClipId.source).toEqual([beforeNote, { ...shiftedNote, startBeat: 7 }]);
        expect(result.state.ccByClipId.source?.[0]?.beat).toBe(7);
        expect(result.state.pitchBendByClipId.source?.[0]?.beat).toBe(7);
        expect(result.state.notesByClipId.source?.[0]).toBe(beforeNote);
        expect(result.state.notesByClipId.dormant).toBe(dormantNotes);
    });

    it('plans and reuses an exact split-right identity before ordered removal', () => {
        const prepared = state({
            notesByClipId: {
                source: [
                    {
                        id: 'straddler',
                        pitch: 67,
                        startBeat: 2,
                        duration: 6,
                        velocity: 88,
                        channel: 9,
                        pressure: 0.4,
                    },
                ],
                right: [{ id: 'existing-right', pitch: 50, startBeat: 0, duration: 1, velocity: 70 }],
                remove: [{ id: 'remove-note', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
            },
            ccByClipId: { remove: [{ id: 'cc', controller: 1, value: 2, beat: 0, channel: 1 }] },
            pitchBendByClipId: { remove: [{ id: 'pb', value: 0.2, beat: 0, channel: 1 }] },
        });
        const commands = [
            { type: 'split-notes' as const, sourceClipId: 'source', targetClipId: 'right', splitBeat: 4 },
            { type: 'remove-clips' as const, clipIds: ['remove'] },
        ];

        const plan = transformMidiGlobalTimeState({ state: prepared, commands });
        expect(plan.identityRequests).toEqual([
            {
                role: 'split-right',
                sourceClipId: 'source',
                sourceNoteId: 'straddler',
                sourceNoteIndex: 0,
                targetClipId: 'right',
            },
        ]);

        const result = transformMidiGlobalTimeState({ state: prepared, commands, targetNoteIds: ['note-replay'] });
        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.source?.[0]).toMatchObject({ id: 'straddler', duration: 2, channel: 9 });
        expect(result.state.notesByClipId.right?.[0]?.id).toBe('existing-right');
        expect(result.state.notesByClipId.right?.[1]).toEqual({
            id: 'note-replay',
            pitch: 67,
            startBeat: 0,
            duration: 4,
            velocity: 88,
            probability: 100,
            pressure: 0.4,
            slide: undefined,
            pitchBend: undefined,
            // The right half is rebuilt field by field, so every per-note
            // expression field has to be named explicitly or it is lost.
            channel: 9,
        });
        expect(result.state.notesByClipId).not.toHaveProperty('remove');
        expect(result.state.ccByClipId).not.toHaveProperty('remove');
        expect(result.state.pitchBendByClipId).not.toHaveProperty('remove');
    });

    it('carries the recorded bend range and articulation onto the split right half', () => {
        // `pitchBendRangeSemitones` is the one MPE field the Web-MIDI recorder
        // actually writes (handleWebMidiNoteOff), and it is what makes a stored
        // `pitchBend` mean anything. Splitting must not strand it on the left.
        const prepared = state({
            notesByClipId: {
                source: [
                    {
                        id: 'expressive',
                        pitch: 72,
                        startBeat: 0,
                        duration: 4,
                        velocity: 100,
                        pitchBend: 0.25,
                        pitchBendRangeSemitones: 48,
                        articulation: 'legato',
                    },
                ],
                right: [],
            },
        });

        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'split-notes' as const, sourceClipId: 'source', targetClipId: 'right', splitBeat: 2 }],
            targetNoteIds: ['note-right'],
        });

        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.right?.[0]).toMatchObject({
            pitchBend: 0.25,
            pitchBendRangeSemitones: 48,
            articulation: 'legato',
        });
    });

    it('duplicates notes after the insert shift without copying CC or pitch bend', () => {
        const sourceNote = {
            id: 'source-note',
            pitch: 200.4,
            startBeat: 1,
            duration: 0,
            velocity: 200.2,
            probability: 45,
            pressure: 0.5,
            channel: 12,
        };
        const sourceCc = { id: 'source-cc', controller: 1, value: 2, beat: 1, channel: 1 };
        const sourcePitchBend = { id: 'source-pb', value: 0.3, beat: 1, channel: 1 };
        const existingTarget = { id: 'existing', pitch: 40, startBeat: 0, duration: 1, velocity: 50 };
        const prepared = state({
            notesByClipId: { source: [sourceNote], target: [existingTarget] },
            ccByClipId: { source: [sourceCc] },
            pitchBendByClipId: { source: [sourcePitchBend] },
        });

        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'source', targetClipId: 'target' }],
            targetNoteIds: ['note-copy'],
        });

        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.target).toEqual([
            existingTarget,
            {
                id: 'note-copy',
                pitch: 127,
                startBeat: 1,
                duration: 0.0625,
                velocity: 127,
                probability: 45,
                pressure: 0.5,
                channel: 12,
            },
        ]);
        expect(result.state.ccByClipId).toBe(prepared.ccByClipId);
        expect(result.state.pitchBendByClipId).toBe(prepared.pitchBendByClipId);
    });

    it('preserves discard-window cases and source ordering', () => {
        const prepared = state({
            notesByClipId: {
                source: [
                    { id: 'left', pitch: 60, startBeat: 0, duration: 1, velocity: 80 },
                    { id: 'span', pitch: 62, startBeat: 1, duration: 8, velocity: 81 },
                    { id: 'inside', pitch: 64, startBeat: 4, duration: 1, velocity: 82 },
                    { id: 'right', pitch: 65, startBeat: 8, duration: 1, velocity: 83 },
                ],
            },
        });

        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'split-notes',
                    sourceClipId: 'source',
                    targetClipId: 'right-clip',
                    splitBeat: 7,
                    discardBeforeBeat: 3,
                },
            ],
            targetNoteIds: ['note-span-right'],
        });

        expect(result.state.notesByClipId.source?.map((note) => note.id)).toEqual(['left', 'span']);
        expect(result.state.notesByClipId['right-clip']?.map((note) => note.id)).toEqual(['note-span-right', 'right']);
        expect(result.state.notesByClipId['right-clip']?.[1]?.startBeat).toBe(1);
    });

    it('rejects missing, extra, duplicate, colliding, and overflowing identity or beat input', () => {
        const prepared = state({
            notesByClipId: {
                source: [{ id: 'existing', pitch: 60, startBeat: Number.MAX_VALUE, duration: 1, velocity: 90 }],
            },
        });
        const copy = [{ type: 'copy-notes' as const, sourceClipId: 'source', targetClipId: 'target' }];

        expect(transformMidiGlobalTimeState({ state: prepared, commands: copy, targetNoteIds: [] }).status).toBe(
            'rejected'
        );
        expect(
            transformMidiGlobalTimeState({ state: prepared, commands: copy, targetNoteIds: ['existing'] }).status
        ).toBe('rejected');
        expect(
            transformMidiGlobalTimeState({ state: prepared, commands: copy, targetNoteIds: ['new', 'extra'] }).status
        ).toBe('rejected');
        const twoNotes = state({
            notesByClipId: {
                source: [
                    { id: 'first', pitch: 60, startBeat: 0, duration: 1, velocity: 90 },
                    { id: 'second', pitch: 62, startBeat: 1, duration: 1, velocity: 90 },
                ],
            },
        });
        expect(
            transformMidiGlobalTimeState({
                state: twoNotes,
                commands: copy,
                targetNoteIds: ['duplicate', 'duplicate'],
            }).status
        ).toBe('rejected');
        const overflowingSplitState = state({
            notesByClipId: {
                source: [
                    {
                        id: 'overflowing',
                        pitch: 60,
                        startBeat: Number.MAX_VALUE,
                        duration: Number.MAX_VALUE,
                        velocity: 90,
                    },
                ],
            },
        });
        expect(
            transformMidiGlobalTimeState({
                state: prepared,
                commands: [{ type: 'shift', atBeat: 1, beatDelta: Number.MAX_VALUE, clips: [straddler] }],
                targetNoteIds: [],
            }).status
        ).toBe('rejected');
        expect(
            transformMidiGlobalTimeState({
                state: overflowingSplitState,
                commands: [
                    {
                        type: 'split-notes',
                        sourceClipId: 'source',
                        targetClipId: 'target',
                        splitBeat: 1,
                    },
                ],
            }).status
        ).toBe('rejected');
    });
});

describe('transformMidiGlobalTimeState shift edge cases', () => {
    it('rejects a shift with a non-finite atBeat (NaN) without touching state', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: Number.NaN, beatDelta: 2, clips: [straddler] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('rejected');
        expect(result.state).toBe(prepared);
    });

    it('rejects a shift with a non-finite beatDelta (Infinity)', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: 4, beatDelta: Number.POSITIVE_INFINITY, clips: [straddler] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('rejected');
    });

    it('treats a zero-beat-delta shift as a no-op ready result', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: 4, beatDelta: 0, clips: [straddler] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(false);
        expect(result.state).toBe(prepared);
    });

    it('rejects when CC events overflow on shift even if notes are fine', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }] },
            ccByClipId: { source: [{ id: 'cc', controller: 1, value: 64, beat: Number.MAX_VALUE, channel: 1 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: 4, beatDelta: Number.MAX_VALUE, clips: [straddler] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('rejected');
    });

    it('rejects when pitch-bend events overflow on shift even if notes and CC are fine', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }] },
            ccByClipId: { source: [{ id: 'cc', controller: 1, value: 64, beat: 5, channel: 1 }] },
            pitchBendByClipId: { source: [{ id: 'pb', value: 0.5, beat: Number.MAX_VALUE, channel: 1 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: 4, beatDelta: Number.MAX_VALUE, clips: [straddler] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('rejected');
    });

    it('reports no changes when all shifted events fall below the clip media window', () => {
        // atBeat=8 sits past the clip end (12)? No — clip is 0..12, atBeat 8 is inside.
        // Use atBeat beyond clip endBeat so the clip is skipped entirely -> no changes.
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 4, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: 20, beatDelta: 2, clips: [straddler] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(false);
        expect(result.state).toBe(prepared);
    });

    it('skips ineligible and out-of-window clips while still shifting eligible ones', () => {
        const eligibleClip = straddler;
        const ineligibleClip = { ...straddler, clipId: 'ineligible', eligible: false };
        const outsideClip = { ...straddler, clipId: 'outside', startBeat: 20, endBeat: 30 };
        const prepared = state({
            notesByClipId: {
                source: [{ id: 'shift-me', pitch: 60, startBeat: 5, duration: 1, velocity: 90 }],
                ineligible: [{ id: 'skip-me', pitch: 60, startBeat: 5, duration: 1, velocity: 90 }],
                outside: [{ id: 'skip-too', pitch: 60, startBeat: 25, duration: 1, velocity: 90 }],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: 4, beatDelta: 2, clips: [eligibleClip, ineligibleClip, outsideClip] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.source?.[0]?.startBeat).toBe(7);
        expect(result.state.notesByClipId.ineligible?.[0]?.startBeat).toBe(5);
        expect(result.state.notesByClipId.outside?.[0]?.startBeat).toBe(25);
    });

    it('reports changes=false for an eligible clip whose events all fall below the media window', () => {
        // atBeat=4, clip 0..12 -> windowStartMedia = 4 - 0 + 0 = 4. A note at beat 2 (<4)
        // is below the window and skipped, so the per-array result carries no changes.
        const prepared = state({
            notesByClipId: { source: [{ id: 'below', pitch: 60, startBeat: 2, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'shift', atBeat: 4, beatDelta: 2, clips: [straddler] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(false);
        expect(result.state).toBe(prepared);
    });

    it('shifts events across two eligible clips, copying the map only once for the first change', () => {
        const prepared = state({
            notesByClipId: {
                a: [{ id: 'a1', pitch: 60, startBeat: 5, duration: 1, velocity: 90 }],
                b: [{ id: 'b1', pitch: 62, startBeat: 5, duration: 1, velocity: 90 }],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'shift',
                    atBeat: 4,
                    beatDelta: 2,
                    clips: [
                        { clipId: 'a', eligible: true, startBeat: 0, endBeat: 12, midiOffsetBeats: 0 },
                        { clipId: 'b', eligible: true, startBeat: 0, endBeat: 12, midiOffsetBeats: 0 },
                    ],
                },
            ],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(true);
        expect(result.state.notesByClipId.a?.[0]?.startBeat).toBe(7);
        expect(result.state.notesByClipId.b?.[0]?.startBeat).toBe(7);
    });

    it('skips clips that carry an empty events array', () => {
        const prepared = state({
            notesByClipId: {
                empty: [],
                source: [{ id: 'shift-me', pitch: 60, startBeat: 5, duration: 1, velocity: 90 }],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                { type: 'shift', atBeat: 4, beatDelta: 2, clips: [straddler, { ...straddler, clipId: 'empty' }] },
            ],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.empty).toEqual([]);
        expect(result.state.notesByClipId.source?.[0]?.startBeat).toBe(7);
    });
});

describe('transformMidiGlobalTimeState split edge cases', () => {
    it('rejects a split with a non-finite splitBeat', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 2, duration: 4, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'split-notes', sourceClipId: 'source', targetClipId: 'right', splitBeat: Number.NaN }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('rejected');
    });

    it('rejects a split with a non-finite discardBeforeBeat', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'n1', pitch: 60, startBeat: 2, duration: 4, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'split-notes',
                    sourceClipId: 'source',
                    targetClipId: 'right',
                    splitBeat: 4,
                    discardBeforeBeat: Number.POSITIVE_INFINITY,
                },
            ],
            targetNoteIds: [],
        });
        expect(result.status).toBe('rejected');
    });

    it('is a no-op when the source clip has no notes', () => {
        const prepared = state({ notesByClipId: { source: [] } });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'split-notes', sourceClipId: 'source', targetClipId: 'right', splitBeat: 4 }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(false);
        expect(result.state).toBe(prepared);
    });

    it('splits without a discard window: left keeps pre-split, right rebases post-split, straddler splits', () => {
        const prepared = state({
            notesByClipId: {
                source: [
                    { id: 'before', pitch: 60, startBeat: 0, duration: 2, velocity: 90 },
                    { id: 'straddle', pitch: 62, startBeat: 2, duration: 4, velocity: 90 },
                    { id: 'after', pitch: 64, startBeat: 7, duration: 1, velocity: 90 },
                ],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'split-notes', sourceClipId: 'source', targetClipId: 'right', splitBeat: 4 }],
            targetNoteIds: ['straddle-right'],
        });
        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.source?.map((n) => n.id)).toEqual(['before', 'straddle']);
        expect(result.state.notesByClipId.source?.[1]?.duration).toBe(2);
        expect(result.state.notesByClipId.right).toEqual([
            {
                id: 'straddle-right',
                pitch: 62,
                startBeat: 0,
                duration: 2,
                velocity: 90,
                probability: 100,
                pressure: undefined,
                slide: undefined,
                pitchBend: undefined,
            },
            { id: 'after', pitch: 64, startBeat: 3, duration: 1, velocity: 90 },
        ]);
    });

    it('rejects when a note end overflows to non-finite during a discard-window split', () => {
        const prepared = state({
            notesByClipId: {
                source: [
                    {
                        id: 'overflow',
                        pitch: 60,
                        startBeat: Number.MAX_VALUE,
                        duration: Number.MAX_VALUE,
                        velocity: 90,
                    },
                ],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'split-notes',
                    sourceClipId: 'source',
                    targetClipId: 'right',
                    splitBeat: 4,
                    discardBeforeBeat: 2,
                },
            ],
            targetNoteIds: ['overflow-right'],
        });
        expect(result.status).toBe('rejected');
    });

    it('plans a deterministic id during a discard-window straddle split when no ids are supplied', () => {
        const prepared = state({
            notesByClipId: {
                source: [{ id: 'span', pitch: 62, startBeat: 1, duration: 8, velocity: 90 }],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'split-notes',
                    sourceClipId: 'source',
                    targetClipId: 'right',
                    splitBeat: 7,
                    discardBeforeBeat: 3,
                },
            ],
        });
        expect(result.status).toBe('ready');
        expect(result.identityRequests).toHaveLength(1);
        expect(result.state.notesByClipId.right?.[0]?.id).toBe('planned-midi-note-0');
    });

    it('in the discard window, a note ending between discard and split stays left-only (no right half)', () => {
        const prepared = state({
            notesByClipId: {
                source: [{ id: 'mid', pitch: 60, startBeat: 1, duration: 3, velocity: 90 }], // end=4, discard=2, split=7
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'split-notes',
                    sourceClipId: 'source',
                    targetClipId: 'right',
                    splitBeat: 7,
                    discardBeforeBeat: 2,
                },
            ],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.source).toEqual([expect.objectContaining({ id: 'mid', duration: 1 })]);
        expect(result.state.notesByClipId.right).toEqual([]);
    });

    it('in the discard window, a note starting at or after splitBeat is rebased into the right clip', () => {
        const prepared = state({
            notesByClipId: {
                source: [{ id: 'post', pitch: 60, startBeat: 8, duration: 2, velocity: 90 }],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'split-notes',
                    sourceClipId: 'source',
                    targetClipId: 'right',
                    splitBeat: 7,
                    discardBeforeBeat: 2,
                },
            ],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.source).toEqual([]);
        expect(result.state.notesByClipId.right).toEqual([expect.objectContaining({ id: 'post', startBeat: 1 })]);
    });

    it('rejects a discard-window straddle split when the supplied target id collides', () => {
        const prepared = state({
            notesByClipId: {
                source: [
                    { id: 'existing', pitch: 60, startBeat: 0, duration: 1, velocity: 90 },
                    { id: 'span', pitch: 62, startBeat: 1, duration: 8, velocity: 90 },
                ],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [
                {
                    type: 'split-notes',
                    sourceClipId: 'source',
                    targetClipId: 'right',
                    splitBeat: 7,
                    discardBeforeBeat: 3,
                },
            ],
            targetNoteIds: ['existing'],
        });
        expect(result.status).toBe('rejected');
    });
});

describe('transformMidiGlobalTimeState copy and removal edge cases', () => {
    it('is a no-op when copying from an empty source clip', () => {
        const prepared = state({ notesByClipId: { source: [], target: [] } });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'source', targetClipId: 'target' }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(false);
        expect(result.state).toBe(prepared);
    });

    it('is a no-op when copying from a source clip that is absent from the note map', () => {
        const prepared = state({ notesByClipId: { target: [] } });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'missing', targetClipId: 'target' }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(false);
        expect(result.state).toBe(prepared);
    });

    it('preserves slide and pitchBend on a cloned note and defaults an undefined velocity', () => {
        const note = {
            id: 'src',
            pitch: 60,
            startBeat: 1,
            duration: 2,
            slide: 0.5,
            pitchBend: 0.25,
        } as Partial<import('../../models/MidiNote').MidiNote>;
        const prepared = state({
            notesByClipId: { source: [note as never], target: [] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'source', targetClipId: 'target' }],
            targetNoteIds: ['clone'],
        });
        expect(result.status).toBe('ready');
        const clone = result.state.notesByClipId.target?.[0];
        expect(clone).toMatchObject({ id: 'clone', slide: 0.5, pitchBend: 0.25, velocity: 100, probability: 100 });
    });

    it('clamps an out-of-range pitch and duration when cloning', () => {
        const note = { id: 'src', pitch: 200, startBeat: 1, duration: -5, velocity: 200 };
        const prepared = state({ notesByClipId: { source: [note], target: [] } });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'source', targetClipId: 'target' }],
            targetNoteIds: ['clone'],
        });
        expect(result.state.notesByClipId.target?.[0]).toMatchObject({ pitch: 127, duration: 0.0625, velocity: 127 });
    });

    it('removal is a no-op when none of the clip ids carry any events', () => {
        const prepared = state({
            notesByClipId: { keep: [{ id: 'n1', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'remove-clips', clipIds: ['nope-a', 'nope-b'] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(false);
        expect(result.state).toBe(prepared);
    });

    it('removal clears matched clip ids across all three event maps', () => {
        const prepared = state({
            notesByClipId: { drop: [{ id: 'n', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }], keep: [] },
            ccByClipId: { drop: [{ id: 'cc', controller: 1, value: 1, beat: 0, channel: 1 }] },
            pitchBendByClipId: { drop: [{ id: 'pb', value: 0, beat: 0, channel: 1 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'remove-clips', clipIds: ['drop'] }],
            targetNoteIds: [],
        });
        expect(result.status).toBe('ready');
        expect(result.hasChanges).toBe(true);
        expect(result.state.notesByClipId).not.toHaveProperty('drop');
        expect(result.state.ccByClipId).not.toHaveProperty('drop');
        expect(result.state.pitchBendByClipId).not.toHaveProperty('drop');
    });
});

describe('transformMidiGlobalTimeState targetNoteId resolution', () => {
    it('rejects when a provided target id collides with an existing note id', () => {
        const prepared = state({
            notesByClipId: {
                source: [{ id: 'src', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }],
                target: [{ id: 'existing', pitch: 50, startBeat: 0, duration: 1, velocity: 80 }],
            },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'source', targetClipId: 'target' }],
            targetNoteIds: ['existing'],
        });
        expect(result.status).toBe('rejected');
    });

    it('rejects when a provided target id is empty/whitespace', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'src', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'source', targetClipId: 'target' }],
            targetNoteIds: ['   '],
        });
        expect(result.status).toBe('rejected');
    });

    it('plans deterministic ids when no targetNoteIds are supplied', () => {
        const prepared = state({
            notesByClipId: { source: [{ id: 'src', pitch: 60, startBeat: 0, duration: 1, velocity: 90 }] },
        });
        const result = transformMidiGlobalTimeState({
            state: prepared,
            commands: [{ type: 'copy-notes', sourceClipId: 'source', targetClipId: 'target' }],
        });
        expect(result.status).toBe('ready');
        expect(result.state.notesByClipId.target?.[0]?.id).toBe('planned-midi-note-0');
    });
});
