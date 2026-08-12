import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateMelody } from '../handleGenerateMelody';

const mocks = vi.hoisted(() => ({
    applyMelodyToTrack: vi.fn<typeof import('../../../useCases/generateMelody/applyToTrack').applyMelodyToTrack>(),
    resolveOrCreateMidiTrack: vi.fn<typeof import('../generationHandlerHelpers').resolveOrCreateMidiTrack>(() => 't1'),
    getPlayheadBeat: vi.fn<typeof import('../generationHandlerHelpers').getPlayheadBeat>(() => 0),
}));

vi.mock('../../../useCases/generateMelody/applyToTrack', () => ({
    applyMelodyToTrack: mocks.applyMelodyToTrack,
}));

vi.mock('../generationHandlerHelpers', () => ({
    getPlayheadBeat: mocks.getPlayheadBeat,
    resolveOrCreateMidiTrack: mocks.resolveOrCreateMidiTrack,
    VALID_MELODY_STYLES: new Set(['simple', 'arpeggiated']),
    VALID_SCALES: new Set(['major', 'minor']),
    VALID_DRUM_STYLES: new Set(['rock', 'house']),
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

describe('handleGenerateMelody', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveOrCreateMidiTrack.mockReturnValue('t1');
    });

    it('executes generation with validated payload and defaults', () => {
        void handleGenerateMelody.execute({
            type: 'generateMelody',
            payload: {
                style: 'arpeggiated',
                scale: 'minor',
                key: 5,
                bars: 4,
                seed: 456,
            },
        });

        expect(mocks.applyMelodyToTrack).toHaveBeenCalledWith(
            't1',
            { style: 'arpeggiated', scale: 'minor', key: 5, bars: 4, seed: 456 },
            0
        );
    });

    it('falls back to default style, scale, and key for invalid inputs', () => {
        void handleGenerateMelody.execute({
            type: 'generateMelody',
            payload: {
                style: 'invalid-style',
                scale: 'invalid-scale',
                key: -5,
                bars: 2,
            },
        });

        expect(mocks.applyMelodyToTrack).toHaveBeenCalledWith(
            't1',
            { style: 'simple', scale: 'major', key: 0, bars: 2 },
            0
        );
    });

    it('bails if track cannot be resolved or created', () => {
        mocks.resolveOrCreateMidiTrack.mockReturnValue(null);

        void handleGenerateMelody.execute({
            type: 'generateMelody',
            payload: { style: 'simple', scale: 'major', key: 0, bars: 1 },
        });

        expect(mocks.applyMelodyToTrack).not.toHaveBeenCalled();
    });

    it('provides a description', () => {
        const desc = handleGenerateMelody.describe({
            type: 'generateMelody',
            payload: { style: 'arpeggiated', scale: 'minor', key: 0, bars: 1 },
        });
        expect(desc.label).toBe('Generate arpeggiated melody');
    });
});
