import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const { glueMidiClipData } = await import('../glueMidiClipData');

function createNote(id: string, startBeat: number) {
    return { id, pitch: 60, startBeat, duration: 1, velocity: 100 };
}

function createControlChange(id: string, beat: number) {
    return { id, controller: 1, value: 64, beat, channel: 1 };
}

function createPitchBend(id: string, beat: number) {
    return { id, value: 256, beat, channel: 1 };
}

function requireMidiState(): MidiStoreState {
    const state = mocks.state.value;
    if (!state) {
        throw new Error('Expected MIDI store state');
    }

    return state;
}

function expectOneStoreRead(): void {
    expect(mocks.getValue).toHaveBeenCalledTimes(1);
}

describe('glueMidiClipData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        };
    });

    it('reads once and does nothing when the MIDI store is unavailable', () => {
        mocks.state.value = null;

        glueMidiClipData({ sourceClipIds: ['source-a', 'source-b'], targetClipId: 'target' });

        expectOneStoreRead();
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBeNull();
    });

    it('merges source rows in selection order, deletes sources, and preserves unrelated row references', () => {
        const sourceNotesA = [createNote('note-a-1', 1), createNote('note-a-2', 2)];
        const sourceNotesB = [createNote('note-b-1', 3)];
        const sourceControlChangesA = [createControlChange('cc-a-1', 1)];
        const sourceControlChangesB = [createControlChange('cc-b-1', 3), createControlChange('cc-b-2', 4)];
        const sourcePitchBendsA = [createPitchBend('pitch-a-1', 1)];
        const sourcePitchBendsB = [createPitchBend('pitch-b-1', 3)];
        const unrelatedNote = createNote('note-keep', 10);
        const unrelatedControlChange = createControlChange('cc-keep', 10);
        const unrelatedPitchBend = createPitchBend('pitch-keep', 10);
        const unrelatedNotes = [unrelatedNote];
        const unrelatedControlChanges = [unrelatedControlChange];
        const unrelatedPitchBends = [unrelatedPitchBend];
        const previousState: MidiStoreState = {
            notesByClipId: {
                'source-a': sourceNotesA,
                'source-b': sourceNotesB,
                keep: unrelatedNotes,
            },
            ccByClipId: {
                'source-a': sourceControlChangesA,
                'source-b': sourceControlChangesB,
                keep: unrelatedControlChanges,
            },
            pitchBendByClipId: {
                'source-a': sourcePitchBendsA,
                'source-b': sourcePitchBendsB,
                keep: unrelatedPitchBends,
            },
        };
        const sourceClipIds = Object.freeze(['source-b', 'source-a']);
        mocks.state.value = previousState;

        glueMidiClipData({ sourceClipIds, targetClipId: 'target' });

        expectOneStoreRead();
        expect(mocks.set).toHaveBeenCalledTimes(1);
        const nextState = requireMidiState();

        expect(nextState.notesByClipId).not.toBe(previousState.notesByClipId);
        expect(nextState.ccByClipId).not.toBe(previousState.ccByClipId);
        expect(nextState.pitchBendByClipId).not.toBe(previousState.pitchBendByClipId);
        expect(nextState.notesByClipId.target).toEqual([...sourceNotesB, ...sourceNotesA]);
        expect(nextState.ccByClipId.target).toEqual([...sourceControlChangesB, ...sourceControlChangesA]);
        expect(nextState.pitchBendByClipId.target).toEqual([...sourcePitchBendsB, ...sourcePitchBendsA]);
        expect(nextState.notesByClipId.target).not.toBe(sourceNotesA);
        expect(nextState.notesByClipId.target).not.toBe(sourceNotesB);
        expect(nextState.ccByClipId.target).not.toBe(sourceControlChangesA);
        expect(nextState.pitchBendByClipId.target).not.toBe(sourcePitchBendsA);
        expect(nextState.notesByClipId.target?.[0]).toBe(sourceNotesB[0]);
        expect(nextState.ccByClipId.target?.[0]).toBe(sourceControlChangesB[0]);
        expect(nextState.pitchBendByClipId.target?.[0]).toBe(sourcePitchBendsB[0]);
        expect(nextState.notesByClipId).not.toHaveProperty('source-a');
        expect(nextState.notesByClipId).not.toHaveProperty('source-b');
        expect(nextState.ccByClipId).not.toHaveProperty('source-a');
        expect(nextState.ccByClipId).not.toHaveProperty('source-b');
        expect(nextState.pitchBendByClipId).not.toHaveProperty('source-a');
        expect(nextState.pitchBendByClipId).not.toHaveProperty('source-b');
        expect(nextState.notesByClipId.keep).toBe(unrelatedNotes);
        expect(nextState.ccByClipId.keep).toBe(unrelatedControlChanges);
        expect(nextState.pitchBendByClipId.keep).toBe(unrelatedPitchBends);
        expect(nextState.notesByClipId.keep?.[0]).toBe(unrelatedNote);
        expect(nextState.ccByClipId.keep?.[0]).toBe(unrelatedControlChange);
        expect(nextState.pitchBendByClipId.keep?.[0]).toBe(unrelatedPitchBend);
        expect(sourceClipIds).toEqual(['source-b', 'source-a']);
        expect(sourceNotesA).toEqual([createNote('note-a-1', 1), createNote('note-a-2', 2)]);
        expect(sourceControlChangesB).toEqual([createControlChange('cc-b-1', 3), createControlChange('cc-b-2', 4)]);
        expect(sourcePitchBendsA).toEqual([createPitchBend('pitch-a-1', 1)]);
    });

    it('writes cloned maps and omits target categories when every source row list is empty', () => {
        const unrelatedNotes = [createNote('note-keep', 10)];
        const unrelatedControlChanges = [createControlChange('cc-keep', 10)];
        const unrelatedPitchBends = [createPitchBend('pitch-keep', 10)];
        const previousState: MidiStoreState = {
            notesByClipId: { source: [], keep: unrelatedNotes },
            ccByClipId: { source: [], keep: unrelatedControlChanges },
            pitchBendByClipId: { source: [], keep: unrelatedPitchBends },
        };
        mocks.state.value = previousState;

        glueMidiClipData({ sourceClipIds: ['source'], targetClipId: 'target' });

        expectOneStoreRead();
        expect(mocks.set).toHaveBeenCalledTimes(1);
        const nextState = requireMidiState();

        expect(nextState.notesByClipId).not.toBe(previousState.notesByClipId);
        expect(nextState.ccByClipId).not.toBe(previousState.ccByClipId);
        expect(nextState.pitchBendByClipId).not.toBe(previousState.pitchBendByClipId);
        expect(nextState.notesByClipId).not.toHaveProperty('source');
        expect(nextState.ccByClipId).not.toHaveProperty('source');
        expect(nextState.pitchBendByClipId).not.toHaveProperty('source');
        expect(nextState.notesByClipId).not.toHaveProperty('target');
        expect(nextState.ccByClipId).not.toHaveProperty('target');
        expect(nextState.pitchBendByClipId).not.toHaveProperty('target');
        expect(nextState.notesByClipId.keep).toBe(unrelatedNotes);
        expect(nextState.ccByClipId.keep).toBe(unrelatedControlChanges);
        expect(nextState.pitchBendByClipId.keep).toBe(unrelatedPitchBends);
    });
});
