import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createGenerationHandler } from '../createGenerationHandler';
import * as helpers from '../generationHandlerHelpers';

vi.mock('../generationHandlerHelpers', () => ({
    VALID_DRUM_STYLES: new Set<string>(),
    VALID_MELODY_STYLES: new Set<string>(),
    VALID_CHORD_STYLES: new Set<string>(),
    VALID_SCALES: new Set<string>(),
    VALID_VOICINGS: new Set<string>(),
    getPlayheadBeat: vi.fn(),
    resolveOrCreateMidiTrack: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addTrack: vi.fn(),
    getTrackStoreState: vi.fn(),
}));

vi.mock('#/modules/Workspace/useCases', () => ({
    selectClipWithFocus: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

describe('createGenerationHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should create a functional handler that validates styles', () => {
        const applySpy = vi.fn();
        const handler = createGenerationHandler({
            validStyles: new Set(['jazz', 'pop']),
            defaultStyle: 'pop',
            labelSuffix: 'melody',
            trackNamePrefix: 'Melody',
            applyToTrack: applySpy,
        } as any);

        vi.mocked(helpers.resolveOrCreateMidiTrack).mockReturnValue('t1');
        vi.mocked(helpers.getPlayheadBeat).mockReturnValue(4);

        // Valid style
        handler.execute({ type: 'generateMelody', payload: { style: 'jazz' } } as any);
        expect(applySpy).toHaveBeenCalledWith('t1', expect.anything(), 'jazz', 4);

        // Invalid style -> fallback
        handler.execute({ type: 'generateMelody', payload: { style: 'metal' } } as any);
        expect(applySpy).toHaveBeenCalledWith('t1', expect.anything(), 'pop', 4);
    });

    it('should abort if track resolution fails', () => {
        const applySpy = vi.fn();
        const handler = createGenerationHandler({
            validStyles: new Set(['pop']),
            defaultStyle: 'pop',
            labelSuffix: 'melody',
            trackNamePrefix: 'Melody',
            applyToTrack: applySpy,
        } as any);

        vi.mocked(helpers.resolveOrCreateMidiTrack).mockReturnValue(null);

        handler.execute({ type: 'generateMelody', payload: { style: 'pop' } } as any);
        expect(applySpy).not.toHaveBeenCalled();
    });
});
