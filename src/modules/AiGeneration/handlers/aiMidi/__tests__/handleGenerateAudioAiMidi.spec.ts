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

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    generateAudio: mocks.generateAudio,
    isAudioGenerationAvailable: mocks.isAudioGenerationAvailable,
}));

describe('handleGenerateAudioAiMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if audio generation is unavailable', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(false);

        await handleGenerateAudioAiMidi.execute({
            type: 'generateAudio',
            payload: { prompt: 'test' },
        });

        expect(mocks.warn).toHaveBeenCalledWith('[Audio AI] Audio generation requires the Sourdaw desktop app');
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
        
        // 4.5 * 2 = 9 beats
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({
            trackId: 'new-track',
            startBeat: 0,
            endBeat: 9,
            name: 'AI: epic drum loop',
            type: 'audio',
        }));
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
        expect(mocks.addClip).toHaveBeenCalledWith(expect.objectContaining({
            trackId: 'existing-track',
        }));
    });

    it('logs warning if generation throws', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(true);
        mocks.addTrack.mockReturnValue({ id: 't' });
        mocks.generateAudio.mockRejectedValue(new Error('API fail'));

        await handleGenerateAudioAiMidi.execute({
            type: 'generateAudio',
            payload: { prompt: 'boom' },
        });

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
