import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type MidiStoreState } from '../../../stores/midiStore';

vi.mock('../../../stores/midiStore', () => {
    const midiStore: {
        value: MidiStoreState | null;
        set: ReturnType<typeof vi.fn>;
    } = {
        value: {
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        },
        set: vi.fn(),
    };
    midiStore.set.mockImplementation((next: MidiStoreState) => {
        midiStore.value = next;
    });
    return { midiStore };
});

const { appendMidiNotes } = await import('../appendMidiNotes');
const { midiStore } = await import('../../../stores/midiStore');

type TestMidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
    channel?: number;
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

function createNote(overrides: Partial<TestMidiNote> = {}): TestMidiNote {
    return {
        id: 'clipboard-note',
        pitch: 64,
        startBeat: 1,
        duration: 0.5,
        velocity: 100,
        ...overrides,
    };
}

function createState(notesByClipId: MidiStoreState['notesByClipId'] = {}): MidiStoreState {
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
        midiStore.value = createState();
    });

    it('appends in existing order with short generated IDs and all expression values in one write', () => {
        const existing = createNote({
            id: 'note-existing',
            pitch: 48,
            startBeat: 4,
            duration: 2,
            velocity: 80,
        });
        const firstPasted = createNote({
            id: 'clipboard-first',
            pitch: 140.25,
            startBeat: -1.5,
            duration: 0,
            velocity: -2,
            probability: 75,
            pressure: 0.25,
            slide: -0.5,
            pitchBend: 1024,
            channel: 13,
        });
        const secondPasted = createNote({
            id: 'clipboard-second',
            pitch: 55,
            startBeat: 3,
            duration: 0.25,
            velocity: 64,
        });
        midiStore.value = createState({ 'clip-1': [existing] });
        const randomUuid = vi
            .spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('12345678-aaaa-bbbb-cccc-dddddddddddd')
            .mockReturnValueOnce('fedcba98-aaaa-bbbb-cccc-dddddddddddd');

        appendMidiNotes({ clipId: 'clip-1', notes: [firstPasted, secondPasted] });

        expect(randomUuid).toHaveBeenCalledTimes(2);
        expect(midiStore.set).toHaveBeenCalledTimes(1);
        expect(midiStore.value).toEqual(
            createState({
                'clip-1': [existing, { ...firstPasted, id: 'note-12345678' }, { ...secondPasted, id: 'note-fedcba98' }],
            })
        );
    });

    it('reads the latest state synchronously when invoked', () => {
        const latestExisting = createNote({ id: 'note-latest', pitch: 45 });
        midiStore.value = createState({ 'clip-1': [createNote({ id: 'note-stale' })] });
        midiStore.value = createState({ 'clip-1': [latestExisting] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('abcdef01-aaaa-bbbb-cccc-dddddddddddd');

        appendMidiNotes({ clipId: 'clip-1', notes: [createNote({ id: 'clipboard-new' })] });

        expect(midiStore.set).toHaveBeenCalledWith(
            createState({
                'clip-1': [latestExisting, { ...createNote({ id: 'clipboard-new' }), id: 'note-abcdef01' }],
            })
        );
    });

    it('treats a missing destination clip list as an empty list', () => {
        const pasted = createNote({ id: 'clipboard-only' });
        midiStore.value = createState({ 'other-clip': [createNote({ id: 'note-other' })] });
        vi.spyOn(crypto, 'randomUUID').mockReturnValue('cafebabe-aaaa-bbbb-cccc-dddddddddddd');

        appendMidiNotes({ clipId: 'new-clip', notes: [pasted] });

        expect(midiStore.value).toEqual(
            createState({
                'other-clip': [createNote({ id: 'note-other' })],
                'new-clip': [{ ...pasted, id: 'note-cafebabe' }],
            })
        );
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
        midiStore.value = null;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');

        appendMidiNotes({ clipId: 'clip-1', notes: [createNote()] });

        expect(randomUuid).not.toHaveBeenCalled();
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBeNull();
    });

    it.each(NON_FINITE_NUMERIC_FIELDS)(
        'rejects a complete batch containing a non-finite %s before UUID or state mutation',
        (field, value) => {
            const stateBefore = midiStore.value;
            const randomUuid = vi.spyOn(crypto, 'randomUUID');
            const invalidNote = { ...createNote(), [field]: value };

            expect(() =>
                appendMidiNotes({ clipId: 'clip-1', notes: [createNote({ id: 'valid-first' }), invalidNote] })
            ).toThrow('Invalid MIDI note batch');

            expect(randomUuid).not.toHaveBeenCalled();
            expect(midiStore.set).not.toHaveBeenCalled();
            expect(midiStore.value).toBe(stateBefore);
        }
    );

    it('rejects a batch with an unknown note key before UUID or state mutation', () => {
        const stateBefore = midiStore.value;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        const invalidNote = { ...createNote(), unsupported: 1 };

        expect(() =>
            appendMidiNotes({ clipId: 'clip-1', notes: [createNote({ id: 'valid-first' }), invalidNote] })
        ).toThrow('Invalid MIDI note batch');

        expect(randomUuid).not.toHaveBeenCalled();
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(stateBefore);
    });

    it('rejects a batch missing a required note key before UUID or state mutation', () => {
        const stateBefore = midiStore.value;
        const randomUuid = vi.spyOn(crypto, 'randomUUID');
        const invalidNote = {
            id: 'missing-velocity',
            pitch: 64,
            startBeat: 1,
            duration: 0.5,
        };

        expect(() =>
            appendMidiNotes({ clipId: 'clip-1', notes: [createNote({ id: 'valid-first' }), invalidNote] })
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
                notes: [createNote({ id: 'first' }), createNote({ id: 'second' })],
            })
        ).toThrow('UUID unavailable');

        expect(randomUuid).toHaveBeenCalledTimes(2);
        expect(midiStore.set).not.toHaveBeenCalled();
        expect(midiStore.value).toBe(stateBefore);
    });
});
