import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../transformers/quantizeMidiNotes', () => ({
    quantizeMidiNotes: vi.fn(),
}));

vi.mock('../../../useCases/midiNoteTransforms/quantizeNotes', () => ({
    quantizeNotes: vi.fn(),
}));

vi.mock('../prepareMidiNoteTransformUndo', () => ({
    prepareMidiNoteTransformUndo: vi.fn(() => ({
        description: {
            label: 'Quantize notes',
            inverseAction: { type: 'restoreMidiClipNotes', payload: { clipId: 'c1' } },
        },
        isNoop: false,
    })),
}));

import { quantizeNotes } from '../../../useCases/midiNoteTransforms/quantizeNotes';
import { handleQuantizeNotes } from '../handleQuantizeNotes';
import { prepareMidiNoteTransformUndo } from '../prepareMidiNoteTransformUndo';

const mockedQuantize = vi.mocked(quantizeNotes);
const mockedPrepare = vi.mocked(prepareMidiNoteTransformUndo);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleQuantizeNotes — execute', () => {
    it('calls quantizeNotes with clipId, gridSize, strength, swing', () => {
        mockedQuantize.mockReturnValue(true);
        const result = handleQuantizeNotes.execute({
            type: 'quantizeNotes',
            payload: { clipId: 'c1', gridSize: 0.25, strength: 1, swing: 0 },
        });
        expect(mockedQuantize).toHaveBeenCalledWith('c1', 0.25, 1, 0);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when quantizeNotes returns false', () => {
        mockedQuantize.mockReturnValue(false);
        const result = handleQuantizeNotes.execute({
            type: 'quantizeNotes',
            payload: { clipId: 'c1', gridSize: 0.25, strength: 1, swing: 0 },
        });
        expect(result).toEqual({ status: 'no-write' });
    });
});

describe('handleQuantizeNotes — describe', () => {
    it('delegates to prepareMidiNoteTransformUndo and returns description', () => {
        const result = handleQuantizeNotes.describe({
            type: 'quantizeNotes',
            payload: { clipId: 'c1', gridSize: 0.25, strength: 1, swing: 0 },
        });
        expect(mockedPrepare).toHaveBeenCalled();
        expect(result.label).toBe('Quantize notes');
        expect(result.inverseAction?.type).toBe('restoreMidiClipNotes');
    });
});

describe('handleQuantizeNotes — isNoop', () => {
    it('delegates to prepareMidiNoteTransformUndo and returns isNoop', () => {
        mockedPrepare.mockReturnValue({ description: { label: 'X' }, isNoop: true });
        expect(
            handleQuantizeNotes.isNoop!({
                type: 'quantizeNotes',
                payload: { clipId: 'c1', gridSize: 0.25, strength: 1, swing: 0 },
            })
        ).toBe(true);
    });
});
