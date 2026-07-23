import { describe, it, expect, vi, beforeEach } from 'vitest';

import { selectClipWithFocus } from '#/modules/Arrangement/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

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
        void handler.execute({ type: 'generateMelody', payload: { style: 'jazz' } } as any);
        expect(applySpy).toHaveBeenCalledWith('t1', expect.anything(), 'jazz', 4);

        // Invalid style -> fallback
        void handler.execute({ type: 'generateMelody', payload: { style: 'metal' } } as any);
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

        void handler.execute({ type: 'generateMelody', payload: { style: 'pop' } } as any);
        expect(applySpy).not.toHaveBeenCalled();
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('no MIDI track available'), 'error');
    });

    it('honours an explicit startBeat over the playhead, clamped to zero', () => {
        const applySpy = vi.fn();
        const handler = createGenerationHandler({
            validStyles: new Set(['pop']),
            defaultStyle: 'pop',
            labelSuffix: 'melody',
            trackNamePrefix: 'Melody',
            applyToTrack: applySpy,
        } as any);

        vi.mocked(helpers.resolveOrCreateMidiTrack).mockReturnValue('t1');
        vi.mocked(helpers.getPlayheadBeat).mockReturnValue(99);

        void handler.execute({ type: 'generateMelody', payload: { style: 'pop', startBeat: -3 } } as any);
        expect(applySpy).toHaveBeenCalledWith('t1', expect.anything(), 'pop', 0);
    });

    it('focuses the new clip and notifies success when notes were generated', () => {
        const applySpy = vi.fn().mockReturnValue({ clipId: 'clip-9', noteCount: 5 });
        const handler = createGenerationHandler({
            validStyles: new Set(['pop']),
            defaultStyle: 'pop',
            labelSuffix: 'melody',
            trackNamePrefix: 'Melody',
            applyToTrack: applySpy,
        } as any);

        vi.mocked(helpers.resolveOrCreateMidiTrack).mockReturnValue('t1');
        vi.mocked(helpers.getPlayheadBeat).mockReturnValue(0);

        void handler.execute({ type: 'generateMelody', payload: { style: 'pop' } } as any);

        expect(selectClipWithFocus).toHaveBeenCalledWith('clip-9');
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('5 notes'), 'success');
    });

    it('warns instead of celebrating when the generator produced zero notes', () => {
        const applySpy = vi.fn().mockReturnValue({ clipId: 'clip-9', noteCount: 0 });
        const handler = createGenerationHandler({
            validStyles: new Set(['pop']),
            defaultStyle: 'pop',
            labelSuffix: 'melody',
            trackNamePrefix: 'Melody',
            applyToTrack: applySpy,
        } as any);

        vi.mocked(helpers.resolveOrCreateMidiTrack).mockReturnValue('t1');
        vi.mocked(helpers.getPlayheadBeat).mockReturnValue(0);

        void handler.execute({ type: 'generateMelody', payload: { style: 'pop' } } as any);

        expect(selectClipWithFocus).toHaveBeenCalledWith('clip-9');
        expect(notifyUser).toHaveBeenCalledWith(expect.stringContaining('produced no notes'), 'warning');
    });

    it('does not focus or notify when applyToTrack returns nothing', () => {
        const applySpy = vi.fn().mockReturnValue(undefined);
        const handler = createGenerationHandler({
            validStyles: new Set(['pop']),
            defaultStyle: 'pop',
            labelSuffix: 'melody',
            trackNamePrefix: 'Melody',
            applyToTrack: applySpy,
        } as any);

        vi.mocked(helpers.resolveOrCreateMidiTrack).mockReturnValue('t1');
        vi.mocked(helpers.getPlayheadBeat).mockReturnValue(0);

        void handler.execute({ type: 'generateMelody', payload: { style: 'pop' } } as any);

        expect(selectClipWithFocus).not.toHaveBeenCalled();
        expect(notifyUser).not.toHaveBeenCalled();
    });

    it('builds a describe label from the action style and configured suffix', () => {
        const handler = createGenerationHandler({
            validStyles: new Set(['pop']),
            defaultStyle: 'pop',
            labelSuffix: 'chord progression',
            trackNamePrefix: 'Chords',
            applyToTrack: vi.fn(),
        } as any);

        const description = handler.describe({ type: 'generateChordProgression', payload: { style: 'jazz' } } as any);
        expect(description).toEqual({ label: 'Generate jazz chord progression' });
    });
});
