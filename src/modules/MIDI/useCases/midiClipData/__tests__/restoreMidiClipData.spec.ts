import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '../../../stores/midiStore';

vi.mock('../../../stores/midiStore', () => {
    const midiStore = {
        value: null as MidiStoreState | null,
        set: vi.fn<(state: MidiStoreState) => void>(),
    };
    midiStore.set.mockImplementation((state) => {
        midiStore.value = state;
    });

    return { midiStore };
});

const { restoreMidiClipData } = await import('../restoreMidiClipData');
const { midiStore } = await import('../../../stores/midiStore');

function createNote(id: string) {
    return { id, pitch: 60, startBeat: 0, duration: 1, velocity: 100 };
}

function createControlChange(id: string) {
    return { id, controller: 1, value: 64, beat: 0, channel: 1 };
}

function createPitchBend(id: string) {
    return { id, value: 256, beat: 0, channel: 1 };
}

function createMidiState(): MidiStoreState {
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

function requireMidiState(): MidiStoreState {
    const state = midiStore.value;
    if (!state) {
        throw new Error('Expected MIDI store state');
    }

    return state;
}

describe('restoreMidiClipData', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        midiStore.value = createMidiState();
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

        const nextState = requireMidiState();

        expect(midiStore.set).toHaveBeenCalledTimes(1);
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

        const nextState = requireMidiState();

        expect(midiStore.set).toHaveBeenCalledTimes(1);
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

        const nextState = requireMidiState();

        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(nextState.notesByClipId['clip-restore']).toEqual([]);
        expect(nextState.ccByClipId['clip-restore']).toEqual([]);
        expect(nextState.pitchBendByClipId['clip-restore']).toEqual([]);
        expect(nextState.notesByClipId['clip-keep']).toBe(previousState.notesByClipId['clip-keep']);
        expect(nextState.ccByClipId['clip-keep']).toBe(previousState.ccByClipId['clip-keep']);
        expect(nextState.pitchBendByClipId['clip-keep']).toBe(previousState.pitchBendByClipId['clip-keep']);
    });

    it('does not validate or write when the store is unavailable, and does not write for all-null snapshots', () => {
        midiStore.value = null;

        expect(() => {
            restoreMidiClipData({
                clipId: 'clip-restore',
                notesSnapshot: [{ unexpected: true }],
                controlChangeSnapshot: null,
                pitchBendSnapshot: null,
            });
        }).not.toThrow();
        expect(midiStore.set).not.toHaveBeenCalled();

        const previousState = createMidiState();
        midiStore.value = previousState;
        vi.clearAllMocks();

        restoreMidiClipData({
            clipId: 'clip-restore',
            notesSnapshot: null,
            controlChangeSnapshot: null,
            pitchBendSnapshot: null,
        });

        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(previousState);
    });

    it('validates the full supplied batch before writing', () => {
        const previousState = requireMidiState();

        expect(() => {
            restoreMidiClipData({
                clipId: 'clip-restore',
                notesSnapshot: [createNote('note-restored')],
                controlChangeSnapshot: [{ id: 'cc-invalid', controller: 1, value: Number.NaN, beat: 0, channel: 1 }],
                pitchBendSnapshot: [createPitchBend('pitch-restored')],
            });
        }).toThrow('Invalid MIDI clip data snapshot');

        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(previousState);
    });

    it('rejects sparse supplied snapshots without writing', () => {
        const previousState = requireMidiState();
        const sparseNotesSnapshot: unknown[] = [];
        sparseNotesSnapshot.length = 1;

        expect(() => {
            restoreMidiClipData({
                clipId: 'clip-restore',
                notesSnapshot: sparseNotesSnapshot,
                controlChangeSnapshot: null,
                pitchBendSnapshot: null,
            });
        }).toThrow('Invalid MIDI clip data snapshot');

        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(previousState);
    });

    it('rejects rows with keys outside the current MIDI models', () => {
        const previousState = requireMidiState();

        expect(() => {
            restoreMidiClipData({
                clipId: 'clip-restore',
                notesSnapshot: [{ ...createNote('note-invalid'), extra: true }],
                controlChangeSnapshot: null,
                pitchBendSnapshot: null,
            });
        }).toThrow('Invalid MIDI clip data snapshot');

        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(previousState);
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
