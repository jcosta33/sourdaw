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

import { transposeNotes } from '../../../useCases/midiNoteTransforms/transposeNotes';
import { handleTransposeNotes } from '../handleTransposeNotes';
import { prepareMidiNoteTransformUndo } from '../prepareMidiNoteTransformUndo';

const mockedTranspose = vi.mocked(transposeNotes);
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
        const arg = mockedPrepare.mock.calls[0]?.[0]!;
        expect(arg.label).toBe('Transpose +3 semitones');
    });

    it('label has no + prefix for negative semitones', () => {
        handleTransposeNotes.describe({ type: 'transposeNotes', payload: { clipId: 'c1', semitones: -5 } });
        const arg = mockedPrepare.mock.calls[0]?.[0]!;
        expect(arg.label).toBe('Transpose -5 semitones');
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
