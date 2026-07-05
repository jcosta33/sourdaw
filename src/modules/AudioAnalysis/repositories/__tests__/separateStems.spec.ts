import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Logger } from '#/infra/logger/types';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { separateStemsBrowser } from '../browserStemSeparation';
import { separateStems } from '../separateStems';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

vi.mock('../browserStemSeparation', () => ({
    separateStemsBrowser: vi.fn(() => Promise.resolve({})),
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

describe('separateStems', () => {
    beforeEach(() => {
        vi.mocked(isTauri).mockReset();
        vi.mocked(tauriInvoke).mockReset();
        vi.mocked(separateStemsBrowser).mockReset();
        vi.mocked(separateStemsBrowser).mockResolvedValue({});
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('should delegate to browser separation when not in Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const logger = createMock<Logger>();
        injectDependencies(separateStems, { logger });

        const audioData = new ArrayBuffer(8);
        await separateStems(audioData);

        expect(separateStemsBrowser).toHaveBeenCalledWith(audioData, ['all']);
        expect(logger.info).toHaveBeenCalledWith('[Audio AI] Separating stems: all');
    });

    it('should use native Tauri separation and keep failed stem loads non-fatal', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        vi.spyOn(Date, 'now').mockReturnValue(42);

        const decodedBuffer = { duration: 2 } as AudioBuffer;
        const audioContexts = installAudioContextStub(decodedBuffer);
        const audioData = new Uint8Array([9, 8, 7, 6]).buffer;
        const vocalsBytes = new Uint8Array([1, 2, 3, 4]);

        vi.mocked(tauriInvoke).mockImplementation((command, payload) => {
            if (command === 'write_audio_file') {
                return Promise.resolve(null);
            }
            if (command === 'separate_stems') {
                return Promise.resolve({
                    stem_paths: {
                        vocals: '/tmp/vocals.wav',
                        drums: '/tmp/drums.wav',
                    },
                    processing_time_ms: 25,
                });
            }
            if (command === 'read_audio_file') {
                if (payload?.path === '/tmp/vocals.wav') {
                    return Promise.resolve(vocalsBytes);
                }
                return Promise.reject(new Error('missing drum stem'));
            }
            return Promise.reject(new Error(`Unexpected command: ${command}`));
        });

        const logger = createMock<Logger>();
        injectDependencies(separateStems, { logger });

        const result = await separateStems(audioData, ['vocals', 'drums']);

        expect(result).toEqual({ vocals: decodedBuffer });
        expect(tauriInvoke).toHaveBeenNthCalledWith(1, 'write_audio_file', {
            path: '__sourdaw_stems_input_42.wav',
            data: new Uint8Array(audioData),
        });
        expect(tauriInvoke).toHaveBeenNthCalledWith(2, 'separate_stems', {
            request: {
                audio_path: '__sourdaw_stems_input_42.wav',
                stems: ['vocals', 'drums'],
            },
        });
        expect(tauriInvoke).toHaveBeenNthCalledWith(3, 'read_audio_file', { path: '/tmp/vocals.wav' });
        expect(tauriInvoke).toHaveBeenNthCalledWith(4, 'read_audio_file', { path: '/tmp/drums.wav' });

        const audioContext = audioContexts[0];
        if (!audioContext) {
            throw new Error('Expected separateStems to create an AudioContext for a loaded stem');
        }
        expect(audioContext.decodeAudioData).toHaveBeenCalledWith(vocalsBytes.buffer);
        expect(audioContext.close).toHaveBeenCalledTimes(1);
        expect(logger.warn).toHaveBeenCalledWith(
            '[Audio AI] Failed to load stem "drums" from /tmp/drums.wav: Error: missing drum stem'
        );
    });
});
