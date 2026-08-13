import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateChordProgression } from '../handleGenerateChordProgression';

const mocks = vi.hoisted(() => ({
    applyChordProgressionToTrack: vi.fn(),
    resolveOrCreateMidiTrack: vi.fn<() => string | null>(() => 't1'),
    getPlayheadBeat: vi.fn(() => 4),
}));

vi.mock('../../../useCases/generateChordProgression/applyToTrack', () => ({
    applyChordProgressionToTrack: mocks.applyChordProgressionToTrack,
}));

vi.mock('../generationHandlerHelpers', () => ({
    getPlayheadBeat: mocks.getPlayheadBeat,
    resolveOrCreateMidiTrack: mocks.resolveOrCreateMidiTrack,
    VALID_CHORD_STYLES: new Set(['pop', 'jazz']),
    VALID_VOICINGS: new Set(['close', 'open']),
    VALID_MELODY_STYLES: new Set(['simple', 'arpeggiated', 'stepwise', 'rhythmic', 'ambient']),
    VALID_SCALES: new Set(['major', 'minor', 'pentatonic', 'minor-pentatonic', 'blues', 'dorian', 'mixolydian']),
    VALID_DRUM_STYLES: new Set(['rock', 'house']),
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

describe('handleGenerateChordProgression', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveOrCreateMidiTrack.mockReturnValue('t1');
    });

    it('executes progression generation with validated payload and defaults', () => {
        void handleGenerateChordProgression.execute({
            type: 'generateChordProgression',
            payload: {
                style: 'jazz',
                scale: 'minor',
                key: 2,
                voicing: 'open',
                bars: 4,
                seed: 789,
            },
        });

        expect(mocks.applyChordProgressionToTrack).toHaveBeenCalledWith(
            't1',
            { style: 'jazz', key: 2, scale: 'minor', voicing: 'open', bars: 4, seed: 789 },
            4
        );
    });

    it('falls back to default style, scale, key, and voicing for invalid inputs', () => {
        void handleGenerateChordProgression.execute({
            type: 'generateChordProgression',
            payload: {
                style: 'invalid-style',
                scale: 'invalid-scale',
                key: 99,
                voicing: 'invalid-voicing',
                bars: 8,
            },
        });

        expect(mocks.applyChordProgressionToTrack).toHaveBeenCalledWith(
            't1',
            { style: 'pop', key: 11, scale: 'major', voicing: 'close', bars: 8 },
            4
        );
    });

    it('bails if track cannot be resolved or created', () => {
        mocks.resolveOrCreateMidiTrack.mockReturnValue(null);

        void handleGenerateChordProgression.execute({
            type: 'generateChordProgression',
            payload: { style: 'pop', scale: 'major', key: 0, bars: 1 },
        });

        expect(mocks.applyChordProgressionToTrack).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const desc = handleGenerateChordProgression.describe({
            type: 'generateChordProgression',
            payload: { style: 'jazz', scale: 'major', key: 0, bars: 1 },
        });
        expect(desc.label).toBe('Generate jazz chord progression');
    });
});
