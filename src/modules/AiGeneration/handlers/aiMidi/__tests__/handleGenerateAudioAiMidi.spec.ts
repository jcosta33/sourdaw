import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGenerateAudioAiMidi } from '../handleGenerateAudioAiMidi';

const mocks = vi.hoisted(() => ({
    addClip: vi.fn(),
    addTrack: vi.fn(),
    cacheSet: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    generateAudio: vi.fn(),
    isAudioGenerationAvailable: vi.fn(),
    notifyUser: vi.fn(),
    getTransportState: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    addClip: mocks.addClip,
    addTrack: mocks.addTrack,
}));

vi.mock('#/modules/AudioEngine/stores', () => ({
    audioBufferCache: { set: mocks.cacheSet },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: mocks.info, warn: mocks.warn },
}));

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: mocks.notifyUser,
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    generateAudio: mocks.generateAudio,
    isAudioGenerationAvailable: mocks.isAudioGenerationAvailable,
}));

vi.mock('#/modules/Transport/useCases', () => ({
    getTransportState: mocks.getTransportState,
}));

const UNAVAILABLE_MESSAGE =
    'Audio generation requires the Sourdaw desktop app (uses Stable Audio Open via Python sidecar)';

describe('handleGenerateAudioAiMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Default: 120 BPM, playhead at 0 (matches the legacy assumption).
        mocks.getTransportState.mockReturnValue({ tempo: 120, playheadPosition: 0 });
    });

    it('bails if audio generation is unavailable', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(false);

        await expect(
            handleGenerateAudioAiMidi.execute({
                type: 'generateAudio',
                payload: { prompt: 'test' },
            })
        ).rejects.toThrow(/Sourdaw desktop/);

        expect(mocks.notifyUser).toHaveBeenCalledWith(UNAVAILABLE_MESSAGE, 'warning');
        expect(mocks.generateAudio).not.toHaveBeenCalled();
    });

    it('creates track, generates audio, and creates clip', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(true);
        mocks.addTrack.mockReturnValue({ id: 'new-track' });

        const mockBuffer = { duration: 4.5, sampleRate: 44100 };
        mocks.generateAudio.mockResolvedValue(mockBuffer);

        await handleGenerateAudioAiMidi.execute({
            type: 'generateAudio',
            payload: { prompt: 'epic drum loop', durationSeconds: 4 },
        });

        expect(mocks.addTrack).toHaveBeenCalledWith({ name: 'AI Audio', kind: 'audio' });
        expect(mocks.generateAudio).toHaveBeenCalledWith('epic drum loop', 4);
        expect(mocks.cacheSet).toHaveBeenCalledWith(expect.any(String), mockBuffer);

        // 4.5s at 120 BPM = 4.5 * 120 / 60 = 9 beats.
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 'new-track',
                startBeat: 0,
                endBeat: 9,
                name: 'AI: epic drum loop',
                type: 'audio',
            })
        );
    });

    it('derives beats from project tempo and places the clip at the playhead', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(true);
        mocks.addTrack.mockReturnValue({ id: 'new-track' });
        // 90 BPM, playhead parked at beat 16.
        mocks.getTransportState.mockReturnValue({ tempo: 90, playheadPosition: 16 });

        const mockBuffer = { duration: 4, sampleRate: 44100 };
        mocks.generateAudio.mockResolvedValue(mockBuffer);

        await handleGenerateAudioAiMidi.execute({
            type: 'generateAudio',
            payload: { prompt: 'pad swell' },
        });

        // 4s at 90 BPM = 4 * 90 / 60 = 6 beats, starting at the playhead (16).
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                startBeat: 16,
                endBeat: 22,
            })
        );
    });

    it('uses existing trackId if provided', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(true);
        const mockBuffer = { duration: 2, sampleRate: 44100 };
        mocks.generateAudio.mockResolvedValue(mockBuffer);

        await handleGenerateAudioAiMidi.execute({
            type: 'generateAudio',
            payload: { prompt: 'boom', trackId: 'existing-track' },
        });

        expect(mocks.addTrack).not.toHaveBeenCalled();
        expect(mocks.addClip).toHaveBeenCalledWith(
            expect.objectContaining({
                trackId: 'existing-track',
            })
        );
    });

    it('logs warning if generation throws', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(true);
        mocks.addTrack.mockReturnValue({ id: 't' });
        mocks.generateAudio.mockRejectedValue(new Error('API fail'));

        await expect(
            handleGenerateAudioAiMidi.execute({
                type: 'generateAudio',
                payload: { prompt: 'boom' },
            })
        ).rejects.toThrow('API fail');

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('Generation failed'));
    });

    it('provides a description', () => {
        const desc = handleGenerateAudioAiMidi.describe({
            type: 'generateAudio',
            payload: { prompt: 'a very very very very long prompt goes here' },
        });
        expect(desc.label).toBe('AI: generate audio "a very very very very long pro"');
    });

    it('is undoable', () => {
        expect(handleGenerateAudioAiMidi.undoable).toBe(true);
    });
});
