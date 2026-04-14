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

describe('handleGenerateAudioAiMidi', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('bails if audio generation is unavailable', async () => {
        mocks.isAudioGenerationAvailable.mockReturnValue(false);

        await expect(
            handleGenerateAudioAiMidi.execute({
                type: 'generateAudio',
                payload: { prompt: 'test' },
            })
        ).rejects.toThrow(/Sourdaw desktop/);

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Audio generation requires the Sourdaw desktop app',
            'warning'
        );
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
