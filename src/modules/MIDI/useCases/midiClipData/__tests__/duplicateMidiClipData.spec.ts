import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreStateInput | null } = { value: null };

    return {
        state,
        getValue: vi.fn((): MidiStoreStateInput | null => state.value),
        set: vi.fn((nextState: MidiStoreStateInput): void => {
            state.value = nextState;
        }),
    };
});

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value(): MidiStoreStateInput | null {
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

function requireMidiState(): MidiStoreStateInput {
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
        const previousState: MidiStoreStateInput = {
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
        const previousState: MidiStoreStateInput = {
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
        const previousState: MidiStoreStateInput = {
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
        const previousState: MidiStoreStateInput = {
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

    it('rollback restores the previously-existing target notes instead of deleting them', () => {
        // Intent: rollback must return a clip to exactly its pre-duplicate
        // state. When the target already held notes before the duplicate, the
        // restore path must put those original notes back — not delete the slot.
        const oldTargetNotes = [createNote('note-original-target')];
        const previousState: MidiStoreStateInput = {
            notesByClipId: { source: [createNote('note-source')], target: oldTargetNotes },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('aaaaaaaa-0000-4000-8000-000000000000');

        const rollback = duplicate([{ sourceClipId: 'source', targetClipId: 'target' }]);
        const duplicatedState = requireMidiState();
        const committedNotes = requireRows(duplicatedState.notesByClipId, 'target');
        expect(committedNotes[0]?.id).toBe('note-dup-aaaaaaaa-0000-4000-8000-000000000000');

        // No intervening change to the target slot -> committed value is still
        // in place -> rollback restores the pre-duplicate value.
        rollback();
        const rolledBackState = requireMidiState();
        expect(rolledBackState.notesByClipId.target).toBe(oldTargetNotes);
        expect(rolledBackState.notesByClipId.target?.[0]?.id).toBe('note-original-target');
    });

    it('rollback skips a target whose control changes were changed by intervening state', () => {
        // Intent: rollback must not clobber a clip that a newer owner wrote to
        // after the duplicate committed. Here the duplicate commits CC into the
        // target, then an intervening write replaces that CC slot; rollback
        // must leave the newer CC untouched.
        const previousState: MidiStoreStateInput = {
            notesByClipId: {},
            ccByClipId: { source: [createControlChange('cc-source')] },
            pitchBendByClipId: {},
        };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('bbbbbbbb-0000-4000-8000-000000000000');

        const rollback = duplicate([{ sourceClipId: 'source', targetClipId: 'target' }]);
        const duplicatedState = requireMidiState();
        const committedControlChanges = requireRows(duplicatedState.ccByClipId, 'target');
        expect(committedControlChanges[0]?.id).toBe('cc-dup-bbbbbbbb-0000-4000-8000-000000000000');

        // Intervening owner writes a fresh CC set into the same target slot.
        const newerControlChanges = [createControlChange('cc-newer')];
        mocks.state.value = {
            ...duplicatedState,
            ccByClipId: { ...duplicatedState.ccByClipId, target: newerControlChanges },
        };

        rollback();
        const rolledBackState = requireMidiState();
        expect(rolledBackState.ccByClipId.target).toBe(newerControlChanges);
    });

    it('rollback skips a target whose pitch bends were changed by intervening state', () => {
        const previousState: MidiStoreStateInput = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: { source: [createPitchBend('pb-source')] },
        };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('cccccccc-0000-4000-8000-000000000000');

        const rollback = duplicate([{ sourceClipId: 'source', targetClipId: 'target' }]);
        const duplicatedState = requireMidiState();
        const committedPitchBends = requireRows(duplicatedState.pitchBendByClipId, 'target');
        expect(committedPitchBends[0]?.id).toBe('pb-dup-cccccccc-0000-4000-8000-000000000000');

        const newerPitchBends = [createPitchBend('pb-newer')];
        mocks.state.value = {
            ...duplicatedState,
            pitchBendByClipId: { ...duplicatedState.pitchBendByClipId, target: newerPitchBends },
        };

        rollback();
        const rolledBackState = requireMidiState();
        expect(rolledBackState.pitchBendByClipId.target).toBe(newerPitchBends);
    });

    it('rollback restores previously-existing target control changes and pitch bends', () => {
        // Mirrors the notes case for CC and pitch bend: when the target already
        // held rows, rollback restores them rather than deleting the slot.
        const oldTargetControlChanges = [createControlChange('cc-original-target')];
        const oldTargetPitchBends = [createPitchBend('pb-original-target')];
        const previousState: MidiStoreStateInput = {
            notesByClipId: {},
            ccByClipId: { source: [createControlChange('cc-source')], target: oldTargetControlChanges },
            pitchBendByClipId: { source: [createPitchBend('pb-source')], target: oldTargetPitchBends },
        };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('dddddddd-0000-4000-8000-000000000000')
            .mockReturnValueOnce('eeeeeeee-0000-4000-8000-000000000000');

        const rollback = duplicate([{ sourceClipId: 'source', targetClipId: 'target' }]);
        const duplicatedState = requireMidiState();
        expect(requireRows(duplicatedState.ccByClipId, 'target')[0]?.id).toBe(
            'cc-dup-dddddddd-0000-4000-8000-000000000000'
        );
        expect(requireRows(duplicatedState.pitchBendByClipId, 'target')[0]?.id).toBe(
            'pb-dup-eeeeeeee-0000-4000-8000-000000000000'
        );

        rollback();
        const rolledBackState = requireMidiState();
        expect(rolledBackState.ccByClipId.target).toBe(oldTargetControlChanges);
        expect(rolledBackState.pitchBendByClipId.target).toBe(oldTargetPitchBends);
    });

    it('rollback deletes a freshly-created target slot and restores an existing one in the same pass', () => {
        // Intent: in one rollback, the compensation must distinguish clips the
        // duplicate created (no previous value -> delete) from clips that
        // pre-existed (previous value -> restore). Using two targets forces the
        // notes map to be shallow-copied once then mutated again on the second
        // target, exercising the "already spread" path of the copy-on-write.
        const existingTargetNotes = [createNote('note-original')];
        const previousState: MidiStoreStateInput = {
            notesByClipId: {
                source: [createNote('note-source')],
                targetExisting: existingTargetNotes,
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('f1f1f1f1-0000-4000-8000-000000000000')
            .mockReturnValueOnce('f2f2f2f2-0000-4000-8000-000000000000');

        const rollback = duplicate([
            { sourceClipId: 'source', targetClipId: 'targetFresh' },
            { sourceClipId: 'source', targetClipId: 'targetExisting' },
        ]);
        const duplicatedState = requireMidiState();
        // Both targets now hold duplicated notes.
        expect(requireRows(duplicatedState.notesByClipId, 'targetFresh')[0]?.id).toBe(
            'note-dup-f1f1f1f1-0000-4000-8000-000000000000'
        );
        expect(requireRows(duplicatedState.notesByClipId, 'targetExisting')[0]?.id).toBe(
            'note-dup-f2f2f2f2-0000-4000-8000-000000000000'
        );

        rollback();
        const rolledBackState = requireMidiState();
        // targetFresh had no previous notes -> deleted.
        expect(rolledBackState.notesByClipId.targetFresh).toBeUndefined();
        // targetExisting had previous notes -> restored.
        expect(rolledBackState.notesByClipId.targetExisting).toBe(existingTargetNotes);
    });

    it('rollback is a no-op when the store has become null before it runs', () => {
        // Intent: rollback must tolerate the store being torn down between
        // commit and rollback without throwing. It marks itself consumed so a
        // later call is still safe.
        const previousState: MidiStoreStateInput = {
            notesByClipId: { source: [createNote('note-source')] },
            ccByClipId: {},
            pitchBendByClipId: {},
        };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('f3f3f3f3-0000-4000-8000-000000000000');

        const rollback = duplicate([{ sourceClipId: 'source', targetClipId: 'target' }]);

        // Store is torn down before rollback runs.
        mocks.state.value = null;
        expect(() => rollback()).not.toThrow();
        // A second rollback must also be safe (consumed guard).
        expect(() => rollback()).not.toThrow();
        expect(mocks.state.value).toBeNull();
    });

    it('rollback restores multiple control-change and pitch-bend targets in one pass', () => {
        // Two CC targets (one fresh, one pre-existing) and two pitch-bend
        // targets likewise — exercises the copy-on-write "already spread" path
        // for both maps plus the delete-vs-restore branch for each.
        const existingCc = [createControlChange('cc-original')];
        const existingPb = [createPitchBend('pb-original')];
        const previousState: MidiStoreStateInput = {
            notesByClipId: {},
            ccByClipId: { source: [createControlChange('cc-source')], targetExisting: existingCc },
            pitchBendByClipId: { source: [createPitchBend('pb-source')], targetExisting: existingPb },
        };
        mocks.state.value = previousState;
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('a1a1a1a1-0000-4000-8000-000000000000')
            .mockReturnValueOnce('a2a2a2a2-0000-4000-8000-000000000000')
            .mockReturnValueOnce('a3a3a3a3-0000-4000-8000-000000000000')
            .mockReturnValueOnce('a4a4a4a4-0000-4000-8000-000000000000');

        const rollback = duplicate([
            { sourceClipId: 'source', targetClipId: 'ccFresh' },
            { sourceClipId: 'source', targetClipId: 'targetExisting' },
        ]);
        const duplicatedState = requireMidiState();
        // Copies are processed in order; within each copy the order is
        // notes -> cc -> pb. notes source is empty, so the UUID sequence is:
        // copy1 cc=a1, copy1 pb=a2, copy2 cc=a3, copy2 pb=a4.
        expect(requireRows(duplicatedState.ccByClipId, 'ccFresh')[0]?.id).toBe(
            'cc-dup-a1a1a1a1-0000-4000-8000-000000000000'
        );
        expect(requireRows(duplicatedState.ccByClipId, 'targetExisting')[0]?.id).toBe(
            'cc-dup-a3a3a3a3-0000-4000-8000-000000000000'
        );
        expect(requireRows(duplicatedState.pitchBendByClipId, 'ccFresh')[0]?.id).toBe(
            'pb-dup-a2a2a2a2-0000-4000-8000-000000000000'
        );
        expect(requireRows(duplicatedState.pitchBendByClipId, 'targetExisting')[0]?.id).toBe(
            'pb-dup-a4a4a4a4-0000-4000-8000-000000000000'
        );

        rollback();
        const rolledBackState = requireMidiState();
        expect(rolledBackState.ccByClipId.ccFresh).toBeUndefined();
        expect(rolledBackState.ccByClipId.targetExisting).toBe(existingCc);
        expect(rolledBackState.pitchBendByClipId.ccFresh).toBeUndefined();
        expect(rolledBackState.pitchBendByClipId.targetExisting).toBe(existingPb);
    });
});
