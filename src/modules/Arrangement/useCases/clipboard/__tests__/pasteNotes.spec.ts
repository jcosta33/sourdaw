import { beforeEach, describe, expect, it, vi } from 'vitest';

import { midiStore } from '#/modules/MIDI/stores';
import { appendMidiNotes, splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';

import { setNoteClipboard } from '../../../stores/clipboardStore';
import { copySelectedNotes } from '../copySelectedNotes';
import { pasteNotes } from '../pasteNotes';

const mocks = vi.hoisted(() => ({
    appendMidiNotes: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/MIDI/useCases')>()),
    appendMidiNotes: mocks.appendMidiNotes,
}));

describe('pasteNotes', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        mocks.appendMidiNotes.mockReset();
        setNoteClipboard(null);
        midiStore.set({
            notesByClipId: {},
            ccByClipId: {},
            pitchBendByClipId: {},
        });
    });

    it('does not invoke MIDI append when no note clipboard exists', () => {
        pasteNotes('clip-id', 0);

        expect(appendMidiNotes).not.toHaveBeenCalled();
    });

    it('does not invoke MIDI append when the note clipboard has no notes', () => {
        setNoteClipboard({ notes: [] });

        pasteNotes('clip-id', 0);

        expect(appendMidiNotes).not.toHaveBeenCalled();
    });

    it('delegates one id-free clipboard-relative note batch with channel preserved', () => {
        const laterNote = {
            id: 'clipboard-later',
            pitch: 72,
            startBeat: 16,
            duration: 0.5,
            velocity: 110,
            probability: 75,
            pressure: 0.25,
            slide: -0.5,
            pitchBend: 1024,
            channel: 9,
        };
        const earlierNote = {
            id: 'clipboard-earlier',
            pitch: 60,
            startBeat: 10,
            duration: 1,
            velocity: 90,
        };
        Reflect.set(laterNote, 'pressure', 'invalid-pressure');
        const randomUuid = vi.spyOn(crypto, 'randomUUID').mockReturnValue('unused-0000-0000-0000-0000');
        setNoteClipboard({ notes: [laterNote, earlierNote] });

        pasteNotes('destination-clip', 3);

        expect(appendMidiNotes).toHaveBeenCalledTimes(1);
        expect(appendMidiNotes).toHaveBeenCalledWith({
            clipId: 'destination-clip',
            notes: [
                {
                    pitch: 72,
                    startBeat: 9,
                    duration: 0.5,
                    velocity: 110,
                    probability: 75,
                    pressure: 'invalid-pressure',
                    slide: -0.5,
                    pitchBend: 1024,
                    channel: 9,
                },
                {
                    pitch: 60,
                    startBeat: 3,
                    duration: 1,
                    velocity: 90,
                },
            ],
        });
        expect(randomUuid).not.toHaveBeenCalled();
    });

    it('preserves zero optional values while omitting explicit undefined values', () => {
        const requiredFields = {
            pitch: 60,
            startBeat: 4,
            duration: 1,
            velocity: 90,
        };
        const zeroOptionals = {
            probability: 0,
            pressure: 0,
            slide: 0,
            pitchBend: 0,
            channel: 0,
        };
        const undefinedOptionals = {
            probability: undefined,
            pressure: undefined,
            slide: undefined,
            pitchBend: undefined,
            channel: undefined,
        };
        setNoteClipboard({
            notes: [
                {
                    id: 'zero-optionals',
                    ...requiredFields,
                    ...zeroOptionals,
                },
                {
                    id: 'undefined-optionals',
                    ...requiredFields,
                    ...undefinedOptionals,
                },
            ],
        });

        pasteNotes('destination-clip', 2);

        expect(mocks.appendMidiNotes).toHaveBeenCalledTimes(1);
        expect(mocks.appendMidiNotes.mock.calls[0]?.[0]).toStrictEqual({
            clipId: 'destination-clip',
            notes: [
                {
                    ...requiredFields,
                    startBeat: 2,
                    ...zeroOptionals,
                },
                {
                    ...requiredFields,
                    startBeat: 2,
                },
            ],
        });
    });

    it('pastes a real split note copied through the Arrangement clipboard', async () => {
        const actualMidiUseCases =
            await vi.importActual<typeof import('#/modules/MIDI/useCases')>('#/modules/MIDI/useCases');
        mocks.appendMidiNotes.mockImplementation(actualMidiUseCases.appendMidiNotes);
        vi.spyOn(crypto, 'randomUUID')
            .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
            .mockReturnValueOnce('22222222-2222-4222-8222-222222222222');
        midiStore.set({
            notesByClipId: {
                source: [
                    {
                        id: 'source-note',
                        pitch: 60,
                        startBeat: 0,
                        duration: 4,
                        velocity: 100,
                    },
                ],
            },
            ccByClipId: {},
            pitchBendByClipId: {},
        });

        splitMidiNotesAtBeat({
            sourceClipId: 'source',
            newClipId: 'split-right',
            splitBeat: 2,
        });
        const splitNote = midiStore.value?.notesByClipId['split-right']?.[0];
        if (!splitNote) {
            throw new Error('Expected a split right-half note');
        }
        // The split writes every optional field onto the right half, so a plain
        // note carries them as own keys holding `undefined`.
        expect(Object.hasOwn(splitNote, 'pressure')).toBe(true);
        expect(Object.hasOwn(splitNote, 'slide')).toBe(true);
        expect(Object.hasOwn(splitNote, 'pitchBend')).toBe(true);
        expect(Object.hasOwn(splitNote, 'pitchBendRangeSemitones')).toBe(true);
        expect(Object.hasOwn(splitNote, 'articulation')).toBe(true);

        copySelectedNotes('split-right', [splitNote.id]);

        expect(() => pasteNotes('destination', 8)).not.toThrow();
        expect(mocks.appendMidiNotes).toHaveBeenCalledTimes(1);
        expect(midiStore.value?.notesByClipId.destination).toEqual([
            {
                // The full UUID, not the 32-bit truncation: repeated pastes into
                // one clip were birthday-bound on the short form.
                id: 'note-22222222-2222-4222-8222-222222222222',
                pitch: 60,
                startBeat: 8,
                duration: 2,
                velocity: 100,
                probability: 100,
                // `pasteNotes` strips only the keys it re-adds conditionally, so
                // these two ride along undefined — the shape `midiStore` and
                // `appendMidiNotes` both read as absent.
                pitchBendRangeSemitones: undefined,
                articulation: undefined,
            },
        ]);
    });
});
