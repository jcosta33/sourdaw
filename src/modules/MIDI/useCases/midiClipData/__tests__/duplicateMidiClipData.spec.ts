import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreState | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): MidiStoreState | null => state.value),
        set: vi.fn((nextState: MidiStoreState): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value(): MidiStoreState | null {
            return mocks.getValue();
        },
        set: mocks.set,
    },
}));

const { duplicateMidiClipData } = await import('../duplicateMidiClipData');

type DuplicateMidiClipDataInput = Parameters<typeof duplicateMidiClipData>[0];

function createNote(id: string) {
    return { id, pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
}

function createControlChange(id: string) {
    return { id, controller: 1, value: 64, beat: 0, channel: 1 };
}

function createPitchBend(id: string) {
    return { id, value: 256, beat: 0, channel: 1 };
}

function requireMidiState(): MidiStoreState {
    const state = mocks.state.value;
    if (state === null) {
        throw new Error('Expected MIDI store state');
    }

    return state;
}

function requireRows<TRow>(map: Record<string, TRow[]>, clipId: string): TRow[] {
    const rows = map[clipId];
    if (rows === undefined) {
        throw new Error(`Expected rows for ${clipId}`);
    }

    return rows;
}

function requireFirst<TRow>(rows: readonly TRow[], label: string): TRow {
    const row = rows[0];
    if (row === undefined) {
        throw new Error(`Expected first ${label}`);
    }

    return row;
}

function duplicate(copies: DuplicateMidiClipDataInput['copies']): ReturnType<typeof duplicateMidiClipData> {
    return duplicateMidiClipData({ copies });
}

describe('duplicateMidiClipData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('does not read empty work and reads a nonempty unavailable store once', () => {
        const rollbackEmptyWork = duplicate([]);

        expect(() => rollbackEmptyWork()).not.toThrow();

        expect(mocks.getValue).not.toHaveBeenCalled();
        expect(mocks.set).not.toHaveBeenCalled();

        mocks.state.value = null;
        vi.clearAllMocks();

        const rollbackUnavailableStore = duplicate([{ sourceClipId: 'source', targetClipId: 'target' }]);

        expect(() => rollbackUnavailableStore()).not.toThrow();

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBeNull();
    });

    it('writes nothing when every source category is empty', () => {
        const previousState: MidiStoreState = {
            notesByClipId: { empty: [], keep: [createNote('note-keep')] },
            ccByClipId: { empty: [], keep: [createControlChange('cc-keep')] },
            pitchBendByClipId: { empty: [], keep: [createPitchBend('pitch-keep')] },
        };
        mocks.state.value = previousState;

        const rollback = duplicate([{ sourceClipId: 'empty', targetClipId: 'target' }]);

        expect(() => rollback()).not.toThrow();

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
    });

    it('copies all MIDI maps with the established IDs while preserving sources, unrelated rows, and inputs', () => {
        const sourceNote = { ...createNote('note-source'), marker: 'note-marker' };
        const sourceControlChange = { ...createControlChange('cc-source'), marker: 'cc-marker' };
        const sourcePitchBend = { ...createPitchBend('pb-source'), marker: 'pb-marker' };
        const unrelatedNote = createNote('note-keep');
        const unrelatedControlChange = createControlChange('cc-keep');
        const unrelatedPitchBend = createPitchBend('pb-keep');
        const sourceNoteBefore = { ...sourceNote };
        const sourceControlChangeBefore = { ...sourceControlChange };
        const sourcePitchBendBefore = { ...sourcePitchBend };
        const previousState: MidiStoreState = {
            notesByClipId: { source: [sourceNote], keep: [unrelatedNote], target: [createNote('note-old')] },
            ccByClipId: {
                source: [sourceControlChange],
                keep: [unrelatedControlChange],
                target: [createControlChange('cc-old')],
            },
            pitchBendByClipId: {
                source: [sourcePitchBend],
                keep: [unrelatedPitchBend],
                target: [createPitchBend('pb-old')],
            },
        };
        const copies = [{ sourceClipId: 'source', targetClipId: 'target' }];
        const copiesBefore = copies.map((copy) => ({ ...copy }));
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('abcdef01-0000-4000-8000-000000000000')
            .mockReturnValueOnce('10203040-0000-4000-8000-000000000000')
            .mockReturnValueOnce('55667788-0000-4000-8000-000000000000');

        const rollback = duplicate(copies);

        const nextState = requireMidiState();
        const copiedNote = requireFirst(requireRows(nextState.notesByClipId, 'target'), 'note');
        const copiedControlChange = requireFirst(requireRows(nextState.ccByClipId, 'target'), 'control change');
        const copiedPitchBend = requireFirst(requireRows(nextState.pitchBendByClipId, 'target'), 'pitch bend');

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(nextState).not.toBe(previousState);
        expect(nextState.notesByClipId).not.toBe(previousState.notesByClipId);
        expect(nextState.ccByClipId).not.toBe(previousState.ccByClipId);
        expect(nextState.pitchBendByClipId).not.toBe(previousState.pitchBendByClipId);
        expect(copiedNote).toEqual({ ...sourceNote, id: 'note-dup-abcdef01-0000-4000-8000-000000000000' });
        expect(copiedControlChange).toEqual({
            ...sourceControlChange,
            id: 'cc-dup-10203040-0000-4000-8000-000000000000',
        });
        expect(copiedPitchBend).toEqual({
            ...sourcePitchBend,
            id: 'pb-dup-55667788-0000-4000-8000-000000000000',
        });
        expect(copiedNote).not.toBe(sourceNote);
        expect(copiedControlChange).not.toBe(sourceControlChange);
        expect(copiedPitchBend).not.toBe(sourcePitchBend);
        expect(nextState.notesByClipId.source).toBe(previousState.notesByClipId.source);
        expect(nextState.ccByClipId.source).toBe(previousState.ccByClipId.source);
        expect(nextState.pitchBendByClipId.source).toBe(previousState.pitchBendByClipId.source);
        expect(nextState.notesByClipId.keep).toBe(previousState.notesByClipId.keep);
        expect(nextState.ccByClipId.keep).toBe(previousState.ccByClipId.keep);
        expect(nextState.pitchBendByClipId.keep).toBe(previousState.pitchBendByClipId.keep);
        expect(sourceNote).toEqual(sourceNoteBefore);
        expect(sourceControlChange).toEqual(sourceControlChangeBefore);
        expect(sourcePitchBend).toEqual(sourcePitchBendBefore);
        expect(copies).toEqual(copiesBefore);

        const replacementNotes = [createNote('note-newer-target')];
        const interveningNotes = [createNote('note-intervening')];
        const interveningControlChanges = [createControlChange('cc-intervening')];
        const interveningPitchBends = [createPitchBend('pb-intervening')];
        mocks.state.value = {
            notesByClipId: { ...nextState.notesByClipId, target: replacementNotes, intervening: interveningNotes },
            ccByClipId: { ...nextState.ccByClipId, intervening: interveningControlChanges },
            pitchBendByClipId: { ...nextState.pitchBendByClipId, intervening: interveningPitchBends },
        };

        expect(() => rollback()).not.toThrow();
        const rolledBackState = requireMidiState();
        expect(rolledBackState.notesByClipId.target).toBe(replacementNotes);
        expect(rolledBackState.ccByClipId.target).toBe(previousState.ccByClipId.target);
        expect(rolledBackState.pitchBendByClipId.target).toBe(previousState.pitchBendByClipId.target);
        expect(rolledBackState.notesByClipId.intervening).toBe(interveningNotes);
        expect(rolledBackState.ccByClipId.intervening).toBe(interveningControlChanges);
        expect(rolledBackState.pitchBendByClipId.intervening).toBe(interveningPitchBends);
        expect(mocks.set).toHaveBeenCalledTimes(2);
        expect(() => rollback()).not.toThrow();
        expect(mocks.set).toHaveBeenCalledTimes(2);
    });

    it('processes batch pairs in order and gives repeated-source rows independent IDs', () => {
        const firstNote = createNote('note-first');
        const firstControlChange = createControlChange('cc-first');
        const secondPitchBend = createPitchBend('pb-second');
        mocks.state.value = {
            notesByClipId: { first: [firstNote] },
            ccByClipId: { first: [firstControlChange] },
            pitchBendByClipId: { second: [secondPitchBend] },
        };
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-0000-4000-8000-000000000000')
            .mockReturnValueOnce('22222222-0000-4000-8000-000000000000')
            .mockReturnValueOnce('33333333-0000-4000-8000-000000000000')
            .mockReturnValueOnce('44444444-0000-4000-8000-000000000000')
            .mockReturnValueOnce('55555555-0000-4000-8000-000000000000');

        duplicate([
            { sourceClipId: 'first', targetClipId: 'target-first' },
            { sourceClipId: 'second', targetClipId: 'target-second' },
            { sourceClipId: 'first', targetClipId: 'target-repeat' },
        ]);

        const nextState = requireMidiState();
        const firstNoteCopy = requireFirst(requireRows(nextState.notesByClipId, 'target-first'), 'first copied note');
        const firstControlChangeCopy = requireFirst(
            requireRows(nextState.ccByClipId, 'target-first'),
            'first copied control change'
        );
        const secondPitchBendCopy = requireFirst(
            requireRows(nextState.pitchBendByClipId, 'target-second'),
            'second copied pitch bend'
        );
        const repeatedNoteCopy = requireFirst(
            requireRows(nextState.notesByClipId, 'target-repeat'),
            'repeated copied note'
        );
        const repeatedControlChangeCopy = requireFirst(
            requireRows(nextState.ccByClipId, 'target-repeat'),
            'repeated copied control change'
        );

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(firstNoteCopy.id).toBe('note-dup-11111111-0000-4000-8000-000000000000');
        expect(firstControlChangeCopy.id).toBe('cc-dup-22222222-0000-4000-8000-000000000000');
        expect(secondPitchBendCopy.id).toBe('pb-dup-33333333-0000-4000-8000-000000000000');
        expect(repeatedNoteCopy.id).toBe('note-dup-44444444-0000-4000-8000-000000000000');
        expect(repeatedControlChangeCopy.id).toBe('cc-dup-55555555-0000-4000-8000-000000000000');
        expect(repeatedNoteCopy).not.toBe(firstNoteCopy);
        expect(repeatedControlChangeCopy).not.toBe(firstControlChangeCopy);
        expect(repeatedNoteCopy).not.toBe(firstNote);
        expect(repeatedControlChangeCopy).not.toBe(firstControlChange);
    });

    it('does not write a partial batch when UUID generation fails', () => {
        const sourceRows = [createNote('note-one'), createNote('note-two')];
        const previousState: MidiStoreState = {
            notesByClipId: { source: sourceRows },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        const uuidFailure = new Error('UUID generation failed');
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('abcdef01-0000-4000-8000-000000000000')
            .mockImplementationOnce(() => {
                throw uuidFailure;
            });

        expect(() => {
            duplicate([{ sourceClipId: 'source', targetClipId: 'target' }]);
        }).toThrow(uuidFailure);

        expect(mocks.getValue).toHaveBeenCalledTimes(1);
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
        expect(sourceRows).toEqual([createNote('note-one'), createNote('note-two')]);
    });

    it('scopes write-then-throw compensation without erasing newer owner state', () => {
        const previousState: MidiStoreState = {
            notesByClipId: { source: [createNote('note-source')] },
            ccByClipId: { source: [createControlChange('cc-source')] },
            pitchBendByClipId: { source: [createPitchBend('pb-source')] },
        };
        const mutationFailure = new Error('MIDI owner mutation failed');
        const replacementNotes = [createNote('note-newer-target')];
        const injectedNotes = [createNote('note-injected')];
        mocks.state.value = previousState;
        mocks.set
            .mockImplementationOnce((nextState) => {
                mocks.state.value = {
                    notesByClipId: { ...nextState.notesByClipId, target: replacementNotes, injected: injectedNotes },
                    ccByClipId: { ...nextState.ccByClipId },
                    pitchBendByClipId: { ...nextState.pitchBendByClipId },
                };
                throw mutationFailure;
            })
            .mockImplementationOnce((nextState) => {
                mocks.state.value = nextState;
            });

        expect(() => duplicate([{ sourceClipId: 'source', targetClipId: 'target' }])).toThrow(mutationFailure);

        expect(mocks.set).toHaveBeenCalledTimes(2);
        const compensatedState = requireMidiState();
        expect(compensatedState.notesByClipId.target).toBe(replacementNotes);
        expect(compensatedState.notesByClipId.injected).toBe(injectedNotes);
        expect(compensatedState.ccByClipId.target).toBeUndefined();
        expect(compensatedState.pitchBendByClipId.target).toBeUndefined();
    });
});
