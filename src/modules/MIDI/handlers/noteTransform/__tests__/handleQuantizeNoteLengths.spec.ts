import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../transformers/quantizeMidiNoteLengths', () => ({
    quantizeMidiNoteLengths: vi.fn(),
}));

vi.mock('../../../useCases/midiNoteTransforms/quantizeNoteLengths', () => ({
    quantizeNoteLengths: vi.fn(),
}));

vi.mock('../prepareMidiNoteTransformUndo', () => ({
    prepareMidiNoteTransformUndo: vi.fn(() => ({
        description: {
            label: 'Quantize note lengths',
            inverseAction: { type: 'restoreMidiClipNotes', payload: { clipId: 'c1' } },
        },
        isNoop: false,
    })),
}));

import { type MidiNote } from '../../../models/MidiNote';
import { quantizeMidiNoteLengths } from '../../../transformers/quantizeMidiNoteLengths';
import { quantizeNoteLengths } from '../../../useCases/midiNoteTransforms/quantizeNoteLengths';
import { handleQuantizeNoteLengths } from '../handleQuantizeNoteLengths';
import { prepareMidiNoteTransformUndo } from '../prepareMidiNoteTransformUndo';

const mockedQuantizeLengths = vi.mocked(quantizeNoteLengths);
const mockedQuantizeLengthsTransformer = vi.mocked(quantizeMidiNoteLengths);
const mockedPrepare = vi.mocked(prepareMidiNoteTransformUndo);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('handleQuantizeNoteLengths — execute', () => {
    it('calls quantizeNoteLengths(clipId, gridSize, noteIds) when noteIds is defined', () => {
        mockedQuantizeLengths.mockReturnValue(true);
        const result = handleQuantizeNoteLengths.execute({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25, noteIds: ['n1', 'n2'] },
        });
        expect(mockedQuantizeLengths).toHaveBeenCalledWith('c1', 0.25, ['n1', 'n2']);
        expect(result).toEqual({ status: 'written' });
    });

    it('calls quantizeNoteLengths(clipId, gridSize) when noteIds is undefined', () => {
        mockedQuantizeLengths.mockReturnValue(true);
        const result = handleQuantizeNoteLengths.execute({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25 },
        });
        expect(mockedQuantizeLengths).toHaveBeenCalledWith('c1', 0.25);
        expect(result).toEqual({ status: 'written' });
    });

    it("returns { status: 'written' } when quantizeNoteLengths returns true", () => {
        mockedQuantizeLengths.mockReturnValue(true);
        const result = handleQuantizeNoteLengths.execute({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.5 },
        });
        expect(result).toEqual({ status: 'written' });
    });

    it("returns { status: 'no-write' } when quantizeNoteLengths returns false", () => {
        mockedQuantizeLengths.mockReturnValue(false);
        const result = handleQuantizeNoteLengths.execute({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25 },
        });
        expect(result).toEqual({ status: 'no-write' });
    });
});

describe('handleQuantizeNoteLengths — describe', () => {
    it("returns label 'Quantize selected note lengths' when noteIds is defined and non-empty", () => {
        handleQuantizeNoteLengths.describe({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25, noteIds: ['n1'] },
        });
        const prepareCall = mockedPrepare.mock.calls[0];
        expect(prepareCall?.[0]?.label).toBe('Quantize selected note lengths');
    });

    it("returns label 'Quantize note lengths' when noteIds is undefined", () => {
        handleQuantizeNoteLengths.describe({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25 },
        });
        const prepareCall = mockedPrepare.mock.calls[0];
        expect(prepareCall?.[0]?.label).toBe('Quantize note lengths');
    });

    it("returns label 'Quantize note lengths' when noteIds is empty", () => {
        handleQuantizeNoteLengths.describe({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25, noteIds: [] },
        });
        const prepareCall = mockedPrepare.mock.calls[0];
        expect(prepareCall?.[0]?.label).toBe('Quantize note lengths');
    });

    it('delegates to prepareMidiNoteTransformUndo and returns description', () => {
        const result = handleQuantizeNoteLengths.describe({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25 },
        });
        expect(mockedPrepare).toHaveBeenCalled();
        expect(result.label).toBe('Quantize note lengths');
        expect(result.inverseAction?.type).toBe('restoreMidiClipNotes');
    });

    it('passes transform callback to prepareMidiNoteTransformUndo that calls quantizeMidiNoteLengths with noteIds', () => {
        handleQuantizeNoteLengths.describe({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.25, noteIds: ['n1', 'n2'] },
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
        expect(mockedQuantizeLengthsTransformer).toHaveBeenCalledWith({
            notes: sampleNotes,
            gridSize: 0.25,
            noteIds: ['n1', 'n2'],
        });
    });

    it('passes transform callback to prepareMidiNoteTransformUndo that calls quantizeMidiNoteLengths without noteIds', () => {
        handleQuantizeNoteLengths.describe({
            type: 'quantizeNoteLengths',
            payload: { clipId: 'c1', gridSize: 0.5 },
        });
        const prepareCall = mockedPrepare.mock.calls[0];
        const transform = prepareCall?.[0]?.transform;
        expect(transform).toBeDefined();

        const sampleNotes: MidiNote[] = [];
        transform?.(sampleNotes);
        expect(mockedQuantizeLengthsTransformer).toHaveBeenCalledWith({
            notes: sampleNotes,
            gridSize: 0.5,
            noteIds: undefined,
        });
    });
});

describe('handleQuantizeNoteLengths — isNoop', () => {
    it('delegates to prepareMidiNoteTransformUndo and returns isNoop', () => {
        mockedPrepare.mockReturnValue({ description: { label: 'X' }, isNoop: true });
        expect(
            handleQuantizeNoteLengths.isNoop!({
                type: 'quantizeNoteLengths',
                payload: { clipId: 'c1', gridSize: 0.25 },
            })
        ).toBe(true);
    });
});
