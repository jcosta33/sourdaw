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
        });
        expect(result.state.notesByClipId).not.toHaveProperty('remove');
        expect(result.state.ccByClipId).not.toHaveProperty('remove');
        expect(result.state.pitchBendByClipId).not.toHaveProperty('remove');
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
