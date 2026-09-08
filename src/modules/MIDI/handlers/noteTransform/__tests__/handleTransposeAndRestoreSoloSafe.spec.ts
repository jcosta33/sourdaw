import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../transformers/transposeMidiNotes', () => ({
    transposeMidiNotes: vi.fn(),
}));

vi.mock('../../../useCases/midiNoteTransforms/transposeNotes', () => ({
    transposeNotes: vi.fn(),
}));

vi.mock('../prepareMidiNoteTransformUndo', () => ({
    prepareMidiNoteTransformUndo: vi.fn(() => ({
        description: {
            label: 'Transpose +3 semitones',
            inverseAction: { type: 'restoreMidiClipNotes', payload: { clipId: 'c1' } },
        },
        isNoop: false,
    })),
}));

import { type MidiNote } from '../../../models/MidiNote';
import { transposeMidiNotes } from '../../../transformers/transposeMidiNotes';
import { transposeNotes } from '../../../useCases/midiNoteTransforms/transposeNotes';
import { handleTransposeNotes } from '../handleTransposeNotes';
import { prepareMidiNoteTransformUndo } from '../prepareMidiNoteTransformUndo';

const mockedTranspose = vi.mocked(transposeNotes);
const mockedTransposeTransformer = vi.mocked(transposeMidiNotes);
const mockedPrepare = vi.mocked(prepareMidiNoteTransformUndo);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleTransposeNotes — execute', () => {
    it('calls transposeNotes and returns written', () => {
        mockedTranspose.mockReturnValue(true);
        const result = handleTransposeNotes.execute({
            type: 'transposeNotes',
            payload: { clipId: 'c1', semitones: 3 },
        });
        expect(mockedTranspose).toHaveBeenCalledWith('c1', 3);
        expect(result).toEqual({ status: 'written' });
    });

    it('passes noteIds through to transposeNotes', () => {
        mockedTranspose.mockReturnValue(true);
        const result = handleTransposeNotes.execute({
            type: 'transposeNotes',
            payload: { clipId: 'c1', semitones: 3, noteIds: ['n1', 'n2'] },
        });
        expect(mockedTranspose).toHaveBeenCalledWith('c1', 3, ['n1', 'n2']);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when transposeNotes returns false', () => {
        mockedTranspose.mockReturnValue(false);
        const result = handleTransposeNotes.execute({
            type: 'transposeNotes',
            payload: { clipId: 'c1', semitones: -2 },
        });
        expect(result).toEqual({ status: 'no-write' });
    });
});

describe('handleTransposeNotes — describe', () => {
    it('delegates to prepareMidiNoteTransformUndo with transposition label', () => {
        handleTransposeNotes.describe({ type: 'transposeNotes', payload: { clipId: 'c1', semitones: 3 } });
        expect(mockedPrepare).toHaveBeenCalled();
        const prepareCall = mockedPrepare.mock.calls[0];
        if (!prepareCall) {
            throw new TypeError('expected prepare to have been called');
        }
        const arg = prepareCall[0];
        expect(arg.label).toBe('Transpose +3 semitones');
    });

    it('label has no + prefix for negative semitones', () => {
        handleTransposeNotes.describe({ type: 'transposeNotes', payload: { clipId: 'c1', semitones: -5 } });
        const prepareCall = mockedPrepare.mock.calls[0];
        if (!prepareCall) {
            throw new TypeError('expected prepare to have been called');
        }
        const arg = prepareCall[0];
        expect(arg.label).toBe('Transpose -5 semitones');
    });

    it('sets selection-scoped label when noteIds is non-empty', () => {
        handleTransposeNotes.describe({
            type: 'transposeNotes',
            payload: { clipId: 'c1', semitones: 3, noteIds: ['n1'] },
        });
        const prepareCall = mockedPrepare.mock.calls[0];
        expect(prepareCall?.[0]?.label).toBe('Transpose selected notes +3 semitones');
    });

    it('passes transform callback to prepareMidiNoteTransformUndo that calls transposeMidiNotes with noteIds', () => {
        handleTransposeNotes.describe({
            type: 'transposeNotes',
            payload: { clipId: 'c1', semitones: 5, noteIds: ['n1', 'n2'] },
        });
        const prepareCall = mockedPrepare.mock.calls[0];
        const transform = prepareCall?.[0]?.transform;
        expect(transform).toBeDefined();

        const sampleNotes: MidiNote[] = [
            {
                id: 'n1',
                pitch: 60,
                startBeat: 0,
                duration: 1,
                velocity: 100,
                probability: 100,
                pressure: 0,
                slide: 0,
                pitchBend: 0,
            },
        ];
        transform?.(sampleNotes);
        expect(mockedTransposeTransformer).toHaveBeenCalledWith({
            notes: sampleNotes,
            semitones: 5,
            noteIds: ['n1', 'n2'],
        });
    });

    it('passes transform callback to prepareMidiNoteTransformUndo that calls transposeMidiNotes without noteIds', () => {
        handleTransposeNotes.describe({
            type: 'transposeNotes',
            payload: { clipId: 'c1', semitones: -2 },
        });
        const prepareCall = mockedPrepare.mock.calls[0];
        const transform = prepareCall?.[0]?.transform;
        expect(transform).toBeDefined();

        const sampleNotes: MidiNote[] = [];
        transform?.(sampleNotes);
        expect(mockedTransposeTransformer).toHaveBeenCalledWith({
            notes: sampleNotes,
            semitones: -2,
            noteIds: undefined,
        });
    });
});

describe('handleTransposeNotes — isNoop', () => {
    it('delegates to prepareMidiNoteTransformUndo', () => {
        mockedPrepare.mockReturnValue({ description: { label: 'X' }, isNoop: true });
        expect(handleTransposeNotes.isNoop!({ type: 'transposeNotes', payload: { clipId: 'c1', semitones: 0 } })).toBe(
            true
        );
    });
});
