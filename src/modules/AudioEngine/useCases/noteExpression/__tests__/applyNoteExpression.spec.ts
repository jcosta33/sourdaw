import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAudioEngine, mockHasNoteExpression, mockResolveControls, mockNormalize } = vi.hoisted(() => ({
    mockAudioEngine: {
        getTrackStrip: vi.fn(() => ({ deviceNodes: [] })),
    },
    mockHasNoteExpression: vi.fn(() => true),
    mockResolveControls: vi.fn(() => ({ noteExpression: vi.fn() })),
    mockNormalize: vi.fn(() => ({
        bendSemitones: 0,
        pressure: 0.5,
        slide: 0,
    })),
}));

vi.mock('../../engineAccess/getAudioContext', () => ({ audioEngine: mockAudioEngine }));
vi.mock('../../../engine/noteExpression', () => ({
    hasNoteExpression: mockHasNoteExpression,
    resolveNoteExpressionControls: mockResolveControls,
    normalizeNoteExpression: mockNormalize,
}));

import { applyNoteExpression } from '../applyNoteExpression';

describe('applyNoteExpression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockHasNoteExpression.mockReturnValue(true);
        mockAudioEngine.getTrackStrip.mockReturnValue({ deviceNodes: [] });
        mockResolveControls.mockReturnValue({ noteExpression: vi.fn() });
        mockNormalize.mockReturnValue({ bendSemitones: 0, pressure: 0.5, slide: 0 });
    });
    it('returns false when the expression has no active values', () => {
        mockHasNoteExpression.mockReturnValueOnce(false);
        const result = applyNoteExpression({
            trackId: 't1',
            note: 60,
            expression: { pitchBend: 0, pressure: 0, slide: 0 },
        });
        expect(result).toBe(false);
    });

    it('returns false when the track has no audio strip', () => {
        mockAudioEngine.getTrackStrip.mockReturnValueOnce(null as never);
        const result = applyNoteExpression({
            trackId: 'unknown',
            note: 60,
            expression: { pitchBend: 100, pressure: 0, slide: 0 },
        });
        expect(result).toBe(false);
    });

    it('returns false when the strip has no note-expression controls', () => {
        mockResolveControls.mockReturnValueOnce(null as never);
        const result = applyNoteExpression({
            trackId: 't1',
            note: 60,
            expression: { pitchBend: 100, pressure: 0, slide: 0 },
        });
        expect(result).toBe(false);
    });

    it('forwards normalized expression values to the controls and returns true', () => {
        const mockNoteExpression = vi.fn();
        mockResolveControls.mockReturnValueOnce({ noteExpression: mockNoteExpression });
        const result = applyNoteExpression({
            trackId: 't1',
            note: 64,
            channel: 3,
            expression: { pitchBend: 2048, pressure: 0.5, slide: 0 },
            sampleFrame: 1024,
            bendRangeSemitones: 12,
        });
        expect(result).toBe(true);
        expect(mockNormalize).toHaveBeenCalledWith({ pitchBend: 2048, pressure: 0.5, slide: 0 }, 12);
        expect(mockNoteExpression).toHaveBeenCalledWith(64, 3, 0, 0.5, 0, 1024);
    });

    it('defaults channel to 0 when not provided', () => {
        const mockNoteExpression = vi.fn();
        mockResolveControls.mockReturnValueOnce({ noteExpression: mockNoteExpression });
        applyNoteExpression({
            trackId: 't1',
            note: 60,
            expression: { pitchBend: 100, pressure: 0, slide: 0 },
        });
        expect(mockNoteExpression.mock.calls[0]?.[1]).toBe(0);
    });
});
