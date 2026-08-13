import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateDrumPattern } from '../handleGenerateDrumPattern';

const mocks = vi.hoisted(() => ({
    applyDrumPatternToTrack: vi.fn(),
    resolveOrCreateMidiTrack: vi.fn<() => string | null>(() => 't1'),
    getPlayheadBeat: vi.fn(() => 8),
}));

vi.mock('../../../useCases/generateDrumPattern/applyToTrack', () => ({
    applyDrumPatternToTrack: mocks.applyDrumPatternToTrack,
}));

vi.mock('../generationHandlerHelpers', () => ({
    getPlayheadBeat: mocks.getPlayheadBeat,
    resolveOrCreateMidiTrack: mocks.resolveOrCreateMidiTrack,
    VALID_DRUM_STYLES: new Set(['rock', 'house']),
    VALID_MELODY_STYLES: new Set(['simple', 'arpeggiated', 'stepwise', 'rhythmic', 'ambient']),
    VALID_SCALES: new Set(['major', 'minor', 'pentatonic', 'minor-pentatonic', 'blues', 'dorian', 'mixolydian']),
    VALID_CHORD_STYLES: new Set(['pop', 'jazz', 'classical', 'edm', 'blues', 'rnb', 'folk', 'cinematic']),
    VALID_VOICINGS: new Set(['close', 'open', 'spread', 'power']),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    selectClipWithFocus: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('handleGenerateDrumPattern', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveOrCreateMidiTrack.mockReturnValue('t1');
    });

    it('executes generation with validated payload and defaults', () => {
        void handleGenerateDrumPattern.execute({
            type: 'generateDrumPattern',
            payload: {
                style: 'house',
                bars: 2,
                density: 0.8,
                seed: 123,
            },
        });

        expect(mocks.applyDrumPatternToTrack).toHaveBeenCalledWith(
            't1',
            { style: 'house', bars: 2, density: 0.8, seed: 123 },
            8
        );
    });

    it('falls back to default style for invalid inputs', () => {
        void handleGenerateDrumPattern.execute({
            type: 'generateDrumPattern',
            payload: {
                // Intentionally passing an invalid style to exercise the runtime fallback
                style: 'invalid-style',
                bars: 4,
                density: 0.5,
            },
        });

        expect(mocks.applyDrumPatternToTrack).toHaveBeenCalledWith('t1', { style: 'rock', bars: 4, density: 0.5 }, 8);
    });

    it('bails if track cannot be resolved or created', () => {
        mocks.resolveOrCreateMidiTrack.mockReturnValue(null);

        void handleGenerateDrumPattern.execute({
            type: 'generateDrumPattern',
            payload: { style: 'rock', bars: 1, density: 0.5 },
        });

        expect(mocks.applyDrumPatternToTrack).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const desc = handleGenerateDrumPattern.describe({
            type: 'generateDrumPattern',
            payload: { style: 'house', bars: 1, density: 0.5 },
        });
        expect(desc.label).toBe('Generate house drum pattern');
    });
});
