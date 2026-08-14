import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState, type MidiStoreStateInput } from '../../../stores/midiStore';

const mocks = vi.hoisted(() => {
    const state: { value: MidiStoreStateInput | null } = { value: null };
    return { state };
});

vi.mock('../../../stores/midiStore', () => ({
    midiStore: {
        get value() {
            return mocks.state.value;
        },
        set: vi.fn((next: MidiStoreStateInput | null) => {
            mocks.state.value = next;
        }),
    },
}));

const { appendMidiNotes } = await import('../appendMidiNotes');
const { midiStore } = await import('../../../stores/midiStore');

// appendMidiNotes validates its input at runtime; widen the parameter type so the
// deliberately-invalid fixtures below can exercise that runtime guard.
const appendMidiNotesUnchecked = appendMidiNotes as (input: { clipId: string; notes: unknown[] }) => void;

type TestAppendNote = {
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    pitchBendRangeSemitones?: number;
    channel?: number;
    articulation?: string;
};

type TestStoredMidiNote = TestAppendNote & {
    id: string;
};

const NON_FINITE_NUMERIC_FIELDS = [
    ['pitch', Number.NaN],
    ['startBeat', Number.POSITIVE_INFINITY],
    ['duration', Number.NEGATIVE_INFINITY],
    ['velocity', Number.NaN],
    ['probability', Number.POSITIVE_INFINITY],
    ['pressure', Number.NaN],
    ['slide', Number.NEGATIVE_INFINITY],
    ['pitchBend', Number.POSITIVE_INFINITY],
    ['channel', Number.NaN],
] as const;

function createAppendNote(overrides: Partial<TestAppendNote> = {}): TestAppendNote {
    return {
        pitch: 64,
        startBeat: 1,
        duration: 0.5,
        velocity: 100,
        ...overrides,
    };
}

function createStoredNote(id: string, overrides: Partial<TestAppendNote> = {}): TestStoredMidiNote {
    return {
        id,
        ...createAppendNote(overrides),
    };
}

function createState(notesByClipId: MidiStoreState['notesByClipId'] = {}): MidiStoreStateInput {
    return {
        notesByClipId,
        ccByClipId: {},
        pitchBendByClipId: {},
    };
}

describe('appendMidiNotes', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        mocks.state.value = createState();
    });

    it('retains deliberately non-sorted existing order and appends generated IDs in one write', () => {
        const existingLater = createStoredNote('note-existing-later', {
            pitch: 48,
            startBeat: 12,
            duration: 2,
            velocity: 80,
        });
        const existingEarlier = createStoredNote('note-existing-earlier', {
            pitch: 36,
            startBeat: 2,
            duration: 1,
            velocity: 70,
        });
        const firstPasted = createAppendNote({
            pitch: 140.25,
            startBeat: -1.5,
            duration: 0,
            velocity: -2,
            probability: 75,
            pressure: 0.25,
            slide: -0.5,
            pitchBend: 1024,
            channel: 13,
            articulation: 'staccato',
        });
        const secondPasted = createAppendNote({
            pitch: 55,
            startBeat: 3,
            duration: 0.25,
            velocity: 64,
        });
        mocks.state.value = createState({ 'clip-1': [existingLater, existingEarlier] });
        const randomUuid = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('12345678-aaaa-bbbb-cccc-dddddddddddd')
            .mockReturnValueOnce('fedcba98-aaaa-bbbb-cccc-dddddddddddd');

        appendMidiNotes({ clipId: 'clip-1', notes: [firstPasted, secondPasted] });

        expect(randomUuid).toHaveBeenCalledTimes(2);
        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(midiStore.value).toEqual(
            createState({
                'clip-1': [
                    existingLater,
                    existingEarlier,
                    { ...firstPasted, id: 'note-12345678-aaaa-bbbb-cccc-dddddddddddd' },
                    { ...secondPasted, id: 'note-fedcba98-aaaa-bbbb-cccc-dddddddddddd' },
                ],
            })
        );
    });

    it('reads the latest state synchronously when invoked', () => {
        const latestExisting = createStoredNote('note-latest', { pitch: 45 });
        mocks.state.value = createState({ 'clip-1': [createStoredNote('note-stale')] });
        mocks.state.value = createState({ 'clip-1': [latestExisting] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('abcdef01-aaaa-bbbb-cccc-dddddddddddd');

        appendMidiNotes({ clipId: 'clip-1', notes: [createAppendNote()] });

        expect(midiStore.set).toHaveBeenCalledWith(
            createState({
                'clip-1': [latestExisting, { ...createAppendNote(), id: 'note-abcdef01-aaaa-bbbb-cccc-dddddddddddd' }],
            })
        );
    });

    it('treats a missing destination clip list as an empty list', () => {
        const pasted = createAppendNote();
        mocks.state.value = createState({ 'other-clip': [createStoredNote('note-other')] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('cafebabe-aaaa-bbbb-cccc-dddddddddddd');

        appendMidiNotes({ clipId: 'new-clip', notes: [pasted] });

        expect(midiStore.value).toEqual(
            createState({
                'other-clip': [createStoredNote('note-other')],
                'new-clip': [{ ...pasted, id: 'note-cafebabe-aaaa-bbbb-cccc-dddddddddddd' }],
            })
        );
    });

    it('keeps ids distinct for UUIDs that share their first 32 bits', () => {
        // Two v4 UUIDs whose first 8 hex digits collide are ~1-in-4-billion
        // apart, which a clip with tens of thousands of pasted notes reaches.
        // Truncating the id merges the two notes for every id-keyed operation.
        const first = createAppendNote({ pitch: 61 });
        const second = createAppendNote({ pitch: 62 });
        mocks.state.value = createState({ 'clip-1': [] });
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('deadbeef-1111-4222-8333-444444444444')
            .mockReturnValueOnce('deadbeef-5555-4666-8777-888888888888');

        appendMidiNotes({ clipId: 'clip-1', notes: [first, second] });

        const stored = midiStore.value?.notesByClipId['clip-1'] ?? [];
        expect(stored.map((note) => note.id)).toEqual([
            'note-deadbeef-1111-4222-8333-444444444444',
            'note-deadbeef-5555-4666-8777-888888888888',
        ]);
    });

    it('does not write or allocate IDs for an empty batch', () => {
        const stateBefore = midiStore.value;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        appendMidiNotes({ clipId: 'clip-1', notes: [] });

        expect(randomUuid).not.toHaveBeenCalled();
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(stateBefore);
    });

    it('does not write or allocate IDs when MIDI state is unavailable', () => {
        mocks.state.value = null;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        appendMidiNotes({ clipId: 'clip-1', notes: [createAppendNote()] });

        expect(randomUuid).not.toHaveBeenCalled();
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBeNull();
    });

    it.each(NON_FINITE_NUMERIC_FIELDS)(
        'rejects a complete batch containing a non-finite %s before UUID or state mutation',
        (field, value) => {
            const stateBefore = midiStore.value;
            const randomUuid = vi.spyOn(crypto, 'randomUUID');
            const invalidNote = { ...createAppendNote(), [field]: value };

            expect(() =>
                appendMidiNotes({ clipId: 'clip-1', notes: [createAppendNote({ pitch: 65 }), invalidNote] })
            ).toThrow('Invalid MIDI note batch');

            expect(randomUuid).not.toHaveBeenCalled();
            expect(midiStore.set).not.toHaveBeenCalled();
            expect(midiStore.value).toBe(stateBefore);
        }
    );

    it('accepts a pasted note carrying the bend range recorded with it', () => {
        // `handleWebMidiPitchBend` stamps `pitchBendRangeSemitones` onto a recorded
        // note, `copySelectedNotes` clones it whole, and `pasteNotes` does not strip
        // it — so refusing the key here throws on pasting any MPE-recorded note.
        expect(() =>
            appendMidiNotesUnchecked({
                clipId: 'clip-1',
                notes: [createAppendNote({ pitchBend: -4096, pitchBendRangeSemitones: 2 })],
            })
        ).not.toThrow();
    });

    it.each([
        ['an unknown key', { ...createAppendNote(), unsupported: 1 }],
        ['a non-numeric bend range', { ...createAppendNote(), pitchBendRangeSemitones: '2' }],
        ['a source id', { ...createAppendNote(), id: 'clipboard-id' }],
        ['a numeric-string required field', { ...createAppendNote(), pitch: '64' }],
        ['a null optional field', { ...createAppendNote(), pressure: null }],
        ['a whitespace-padded articulation', { ...createAppendNote(), articulation: ' accent ' }],
        ['an empty articulation', { ...createAppendNote(), articulation: '' }],
        ['an oversized articulation', { ...createAppendNote(), articulation: 'a'.repeat(129) }],
        ['a control-character articulation', { ...createAppendNote(), articulation: 'accent\n' }],
    ])('rejects a batch with %s before UUID or state mutation', (_case, invalidNote) => {
        const stateBefore = midiStore.value;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        expect(() =>
            appendMidiNotesUnchecked({ clipId: 'clip-1', notes: [createAppendNote({ pitch: 65 }), invalidNote] })
        ).toThrow('Invalid MIDI note batch');

        expect(randomUuid).not.toHaveBeenCalled();
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(stateBefore);
    });

    it('rejects a batch missing a required note key before UUID or state mutation', () => {
        const stateBefore = midiStore.value;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        const invalidNote = {
            pitch: 64,
            startBeat: 1,
            duration: 0.5,
        };

        expect(() =>
            appendMidiNotesUnchecked({ clipId: 'clip-1', notes: [createAppendNote({ pitch: 65 }), invalidNote] })
        ).toThrow('Invalid MIDI note batch');

        expect(randomUuid).not.toHaveBeenCalled();
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(stateBefore);
    });

    it('leaves state untouched when UUID allocation fails partway through a valid batch', () => {
        const stateBefore = midiStore.value;
        const randomUuid = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('12345678-aaaa-bbbb-cccc-dddddddddddd')
            .mockImplementationOnce(() => {
                throw new Error('UUID unavailable');
            });

        expect(() =>
            appendMidiNotes({
                clipId: 'clip-1',
                notes: [createAppendNote({ pitch: 65 }), createAppendNote({ pitch: 66 })],
            })
        ).toThrow('UUID unavailable');

        expect(randomUuid).toHaveBeenCalledTimes(2);
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(stateBefore);
    });
});
