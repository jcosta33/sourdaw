import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Logger } from '#/infra/logger/types';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { generateAudio } from '../generateAudio';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

type TestAudioContextInstance = {
    decodeAudioData: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
};

function installAudioContextStub(decodedBuffer: AudioBuffer): TestAudioContextInstance[] {
    const audioContexts: TestAudioContextInstance[] = [];

    class TestAudioContext {
        public readonly decodeAudioData = vi.fn(() => Promise.resolve(decodedBuffer));
        public readonly close = vi.fn(() => Promise.resolve(undefined));

        public constructor() {
            audioContexts.push(this);
        }
    }

    vi.stubGlobal('AudioContext', TestAudioContext);
    return audioContexts;
}

describe('generateAudio', () => {
    beforeEach(() => {
        vi.mocked(isTauri).mockReset();
        vi.mocked(tauriInvoke).mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should reject when not running in Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const logger = createMock<Logger>();
        injectDependencies(generateAudio, { logger });

        await expect(generateAudio('bells', 4)).rejects.toThrow(/desktop-only/);
        expect(tauriInvoke).not.toHaveBeenCalled();
    });

    it('should invoke Stable Audio, decode the generated WAV, and close the context', async () => {
        vi.mocked(isTauri).mockReturnValue(true);

        const decodedBuffer = { duration: 8 } as AudioBuffer;
        const audioContexts = installAudioContextStub(decodedBuffer);
        const wavBytes = new Uint8Array([1, 2, 3, 4]);

        vi.mocked(tauriInvoke)
            .mockResolvedValueOnce({
                wav_path: '/tmp/generated.wav',
                duration_seconds: 8,
                sample_rate: 48000,
            })
            .mockResolvedValueOnce(wavBytes);

        const logger = createMock<Logger>();
        injectDependencies(generateAudio, { logger });

        const result = await generateAudio('warm pad');

        expect(result).toBe(decodedBuffer);
        expect(tauriInvoke).toHaveBeenNthCalledWith(1, 'generate_audio_clip', {
            prompt: 'warm pad',
            bpm: null,
            key: null,
            durationBars: null,
            durationSeconds: 8,
        });
        expect(tauriInvoke).toHaveBeenNthCalledWith(2, 'read_audio_file', { path: '/tmp/generated.wav' });

        const audioContext = audioContexts[0];
        if (!audioContext) {
            throw new Error('Expected generateAudio to create an AudioContext');
        }
        expect(audioContext.decodeAudioData).toHaveBeenCalledWith(wavBytes.buffer);
        expect(audioContext.close).toHaveBeenCalledTimes(1);
    });
});
