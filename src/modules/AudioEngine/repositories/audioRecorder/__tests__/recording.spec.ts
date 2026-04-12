import { describe, it, expect, vi, beforeEach } from 'vitest';
import { startAudioRecording } from '../recording';
import { audioEngine } from '../../createWebAudioEngine';
import { getSelectedInputId } from '../../../useCases/audioDeviceSelection/getSelectedInputId';
import { logger } from '#/infra/logger/appLogger';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            sampleRate: 48000,
            createMediaStreamSource: vi.fn(() => ({
                connect: vi.fn(),
            })),
            createBuffer: vi.fn(),
        },
        ensureTrackStrip: vi.fn(() => ({
            gainNode: { connect: vi.fn() },
        })),
    },
}));

vi.mock('../../../useCases/audioDeviceSelection/getSelectedInputId', () => ({
    getSelectedInputId: vi.fn(() => null),
}));

describe('startAudioRecording', () => {
    beforeEach(() => {
        vi.mocked(getSelectedInputId).mockReturnValue(null);
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockRejectedValue(new Error('mic denied')),
            },
            configurable: true,
        });
    });

    it('should return false and log when microphone access fails', async () => {
        const onComplete = vi.fn();
        const ok = await startAudioRecording('track-1', onComplete);

        expect(ok).toBe(false);
        expect(logger.error).toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(audioEngine.ensureTrackStrip).not.toHaveBeenCalled();
    });
});
