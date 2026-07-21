import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreStateInput } from '../../../stores/midiStore';

const INVALID_MIDI_CLIP_DATA_SNAPSHOT = 'Invalid MIDI clip data snapshot';

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

vi.mock('../../../stores/midiStore', () => {
    return {
        midiStore: {
            get value(): MidiStoreStateInput | null {
                return mocks.getValue();
            },
            set: mocks.set,
        },
    };
});

const { restoreMidiClipData } = await import('../restoreMidiClipData');

type RestoreMidiClipDataInput = Parameters<typeof restoreMidiClipData>[0];
type MidiSnapshotInput = Omit<RestoreMidiClipDataInput, 'clipId'>;

type InvalidSnapshotCase = {
    label: string;
    snapshots: MidiSnapshotInput;
};

function createNote(id: string) {
    return { id, pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
}

function createControlChange(id: string) {
    return { id, controller: 1, value: 64, beat: 0, channel: 1 };
}

function createPitchBend(id: string) {
    return { id, value: 256, beat: 0, channel: 1 };
}

function createMidiState(): MidiStoreStateInput {
    return {
        notesByClipId: {
            'clip-restore': [createNote('note-existing')],
            'clip-keep': [createNote('note-keep')],
        },
        ccByClipId: {
            'clip-restore': [createControlChange('cc-existing')],
            'clip-keep': [createControlChange('cc-keep')],
        },
        pitchBendByClipId: {
            'clip-restore': [createPitchBend('pitch-existing')],
            'clip-keep': [createPitchBend('pitch-keep')],
        },
    };
}

function requireMidiState(): MidiStoreStateInput {
    const state = mocks.state.value;
    if (!state) {
        throw new Error('Expected MIDI store state');
    }

    return state;
}

function createSnapshots(overrides: Partial<MidiSnapshotInput>): MidiSnapshotInput {
    return {
        notesSnapshot: null,
        controlChangeSnapshot: null,
        pitchBendSnapshot: null,
        ...overrides,
    };
}

function createSparseSnapshot(): unknown[] {
    const snapshot: unknown[] = [];
    snapshot.length = 1;
    return snapshot;
}

function expectOneStoreRead(): void {
    expect(mocks.getValue).toHaveBeenCalledTimes(1);
}

const INVALID_SNAPSHOT_CASES = [
    {
        label: 'numeric note id',
        snapshots: createSnapshots({ notesSnapshot: [{ ...createNote('note-invalid'), id: 1 }] }),
    },
    {
        label: 'numeric control-change id',
        snapshots: createSnapshots({ controlChangeSnapshot: [{ ...createControlChange('cc-invalid'), id: 1 }] }),
    },
    {
        label: 'numeric pitch-bend id',
        snapshots: createSnapshots({ pitchBendSnapshot: [{ ...createPitchBend('pitch-invalid'), id: 1 }] }),
    },
    {
        label: 'missing note velocity',
        snapshots: createSnapshots({
            notesSnapshot: [{ id: 'note-invalid', pitch: 60, startBeat: 0, duration: 1 }],
        }),
    },
    {
        label: 'infinite note duration',
        snapshots: createSnapshots({
            notesSnapshot: [{ ...createNote('note-invalid'), duration: Infinity }],
        }),
    },
    {
        label: 'note extra key',
        snapshots: createSnapshots({ notesSnapshot: [{ ...createNote('note-invalid'), extra: true }] }),
    },
    {
        label: 'infinite control-change value',
        snapshots: createSnapshots({
            notesSnapshot: [createNote('note-restored')],
            controlChangeSnapshot: [{ ...createControlChange('cc-invalid'), value: Infinity }],
            pitchBendSnapshot: [createPitchBend('pitch-restored')],
        }),
    },
    {
        label: 'invalid note optional',
        snapshots: createSnapshots({
            notesSnapshot: [{ ...createNote('note-invalid'), probability: 'invalid' }],
        }),
    },
    {
        label: 'control-change extra key',
        snapshots: createSnapshots({ controlChangeSnapshot: [{ ...createControlChange('cc-invalid'), extra: true }] }),
    },
    {
        label: 'pitch-bend extra key',
        snapshots: createSnapshots({ pitchBendSnapshot: [{ ...createPitchBend('pitch-invalid'), extra: true }] }),
    },
    {
        label: 'infinite pitch-bend beat',
        snapshots: createSnapshots({
            pitchBendSnapshot: [{ ...createPitchBend('pitch-invalid'), beat: Infinity }],
        }),
    },
    { label: 'sparse notes', snapshots: createSnapshots({ notesSnapshot: createSparseSnapshot() }) },
    { label: 'sparse control changes', snapshots: createSnapshots({ controlChangeSnapshot: createSparseSnapshot() }) },
    { label: 'sparse pitch bends', snapshots: createSnapshots({ pitchBendSnapshot: createSparseSnapshot() }) },
] satisfies readonly InvalidSnapshotCase[];

describe('restoreMidiClipData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.state.value = createMidiState();
    });

    it('replaces all supplied clip maps and preserves unrelated entries', () => {
        const previousState = requireMidiState();
        const notesSnapshot = [createNote('note-restored')];
        const controlChangeSnapshot = [createControlChange('cc-restored')];
        const pitchBendSnapshot = [createPitchBend('pitch-restored')];

        restoreMidiClipData({
            clipId: 'clip-restore',
            notesSnapshot,
            controlChangeSnapshot,
            pitchBendSnapshot,
        });

        expectOneStoreRead();
        const nextState = requireMidiState();

        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(nextState).not.toBe(previousState);
        expect(nextState.notesByClipId).not.toBe(previousState.notesByClipId);
        expect(nextState.ccByClipId).not.toBe(previousState.ccByClipId);
        expect(nextState.pitchBendByClipId).not.toBe(previousState.pitchBendByClipId);
        expect(nextState.notesByClipId['clip-restore']).toEqual(notesSnapshot);
        expect(nextState.ccByClipId['clip-restore']).toEqual(controlChangeSnapshot);
        expect(nextState.pitchBendByClipId['clip-restore']).toEqual(pitchBendSnapshot);
        expect(nextState.notesByClipId['clip-keep']).toBe(previousState.notesByClipId['clip-keep']);
        expect(nextState.ccByClipId['clip-keep']).toBe(previousState.ccByClipId['clip-keep']);
        expect(nextState.pitchBendByClipId['clip-keep']).toBe(previousState.pitchBendByClipId['clip-keep']);
    });

    it('only clones maps with a supplied snapshot', () => {
        const previousState = requireMidiState();
        const notesSnapshot = [createNote('note-restored')];

        restoreMidiClipData({
            clipId: 'clip-restore',
            notesSnapshot,
            controlChangeSnapshot: null,
            pitchBendSnapshot: null,
        });

        expectOneStoreRead();
        const nextState = requireMidiState();

        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(nextState).not.toBe(previousState);
        expect(nextState.notesByClipId).not.toBe(previousState.notesByClipId);
        expect(nextState.ccByClipId).toBe(previousState.ccByClipId);
        expect(nextState.pitchBendByClipId).toBe(previousState.pitchBendByClipId);
        expect(nextState.notesByClipId['clip-restore']).toEqual(notesSnapshot);
    });

    it('replaces entries with empty supplied snapshots', () => {
        const previousState = requireMidiState();

        restoreMidiClipData({
            clipId: 'clip-restore',
            notesSnapshot: [],
            controlChangeSnapshot: [],
            pitchBendSnapshot: [],
        });

        expectOneStoreRead();
        const nextState = requireMidiState();

        expect(mocks.set).toHaveBeenCalledTimes(1);
        expect(nextState.notesByClipId['clip-restore']).toEqual([]);
        expect(nextState.ccByClipId['clip-restore']).toEqual([]);
        expect(nextState.pitchBendByClipId['clip-restore']).toEqual([]);
        expect(nextState.notesByClipId['clip-keep']).toBe(previousState.notesByClipId['clip-keep']);
        expect(nextState.ccByClipId['clip-keep']).toBe(previousState.ccByClipId['clip-keep']);
        expect(nextState.pitchBendByClipId['clip-keep']).toBe(previousState.pitchBendByClipId['clip-keep']);
    });

    it('does not validate or write when the store is unavailable, and does not write for all-null snapshots', () => {
        mocks.state.value = null;

        expect(() => {
            restoreMidiClipData({
                clipId: 'clip-restore',
                notesSnapshot: [{ unexpected: true }],
                controlChangeSnapshot: null,
                pitchBendSnapshot: null,
            });
        }).not.toThrow();
        expectOneStoreRead();
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBeNull();

        const previousState = createMidiState();
        mocks.state.value = previousState;
        vi.clearAllMocks();

        restoreMidiClipData({
            clipId: 'clip-restore',
            notesSnapshot: null,
            controlChangeSnapshot: null,
            pitchBendSnapshot: null,
        });

        expectOneStoreRead();
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
    });

    it.each(INVALID_SNAPSHOT_CASES)('rejects $label snapshots without writing', ({ snapshots }) => {
        const previousState = requireMidiState();

        expect(() => {
            restoreMidiClipData({
                clipId: 'clip-restore',
                ...snapshots,
            });
        }).toThrow(INVALID_MIDI_CLIP_DATA_SNAPSHOT);

        expectOneStoreRead();
        expect(mocks.set).not.toHaveBeenCalled();
        expect(mocks.state.value).toBe(previousState);
    });

    it('preserves own undefined MIDI note optionals', () => {
        const noteWithUndefinedOptionals = {
            ...createNote('note-with-undefined-optionals'),
            probability: undefined,
            pressure: undefined,
            slide: undefined,
            pitchBend: undefined,
            channel: undefined,
        };
        const notesSnapshot = [noteWithUndefinedOptionals];

        restoreMidiClipData({
            clipId: 'clip-restore',
            notesSnapshot,
            controlChangeSnapshot: null,
            pitchBendSnapshot: null,
        });

        expectOneStoreRead();
        const restoredNote = requireMidiState().notesByClipId['clip-restore']?.[0];
        if (!restoredNote) {
            throw new Error('Expected restored note');
        }

        expect(restoredNote).toBe(noteWithUndefinedOptionals);
        expect(Object.hasOwn(restoredNote, 'probability')).toBe(true);
        expect(Object.hasOwn(restoredNote, 'pressure')).toBe(true);
        expect(Object.hasOwn(restoredNote, 'slide')).toBe(true);
        expect(Object.hasOwn(restoredNote, 'pitchBend')).toBe(true);
        expect(Object.hasOwn(restoredNote, 'channel')).toBe(true);
    });

    it('copies supplied arrays without cloning their row objects', () => {
        const note = createNote('note-restored');
        const controlChange = createControlChange('cc-restored');
        const pitchBend = createPitchBend('pitch-restored');
        const notesSnapshot = [note];
        const controlChangeSnapshot = [controlChange];
        const pitchBendSnapshot = [pitchBend];

        restoreMidiClipData({
            clipId: 'clip-restore',
            notesSnapshot,
            controlChangeSnapshot,
            pitchBendSnapshot,
        });

        expectOneStoreRead();
        const nextState = requireMidiState();

        expect(nextState.notesByClipId['clip-restore']).not.toBe(notesSnapshot);
        expect(nextState.ccByClipId['clip-restore']).not.toBe(controlChangeSnapshot);
        expect(nextState.pitchBendByClipId['clip-restore']).not.toBe(pitchBendSnapshot);
        expect(nextState.notesByClipId['clip-restore']?.[0]).toBe(note);
        expect(nextState.ccByClipId['clip-restore']?.[0]).toBe(controlChange);
        expect(nextState.pitchBendByClipId['clip-restore']?.[0]).toBe(pitchBend);

        notesSnapshot.push(createNote('note-later'));
        controlChangeSnapshot.push(createControlChange('cc-later'));
        pitchBendSnapshot.push(createPitchBend('pitch-later'));

        expect(nextState.notesByClipId['clip-restore']).toEqual([note]);
        expect(nextState.ccByClipId['clip-restore']).toEqual([controlChange]);
        expect(nextState.pitchBendByClipId['clip-restore']).toEqual([pitchBend]);
    });
});
