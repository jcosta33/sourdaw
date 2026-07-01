import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { audioEngine } from '../../createWebAudioEngine';
import { startAudioRecording } from '../recording';
import { stopAudioRecording } from '../stopAudioRecording';

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

describe('startAudioRecording', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockRejectedValue(new Error('mic denied')),
            },
            configurable: true,
        });
    });

    it('should return false and log when microphone access fails', async () => {
        const onComplete = vi.fn();

        await expect(startAudioRecording('track-1', onComplete)).resolves.toBe(false);
        expect(logger.error).toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(audioEngine.ensureTrackStrip).not.toHaveBeenCalled();
    });
});

describe('startAudioRecording', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockResolvedValue({
                    getTracks: () => [{ stop: vi.fn() }],
                }),
            },
            configurable: true,
        });
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue({
            connect: vi.fn(),
            disconnect: vi.fn(),
        } as MediaStreamAudioSourceNode);
        vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
        vi.stubGlobal(
            'Worker',
            class {
                onmessage: ((event: { data: unknown }) => void) | null = null;
                postMessage = vi.fn();
                terminate = vi.fn();
                constructor() {
                    setTimeout(() => {
                        this.onmessage?.({ data: { type: 'ready' } });
                    }, 0);
                }
            }
        );
        vi.stubGlobal(
            'AudioWorkletNode',
            class {
                port = { postMessage: vi.fn() };
                connect = vi.fn();
                disconnect = vi.fn();
            }
        );
        vi.stubGlobal('URL', class {});
    });

    afterEach(() => {
        stopAudioRecording();
        vi.advanceTimersByTime(5_000);
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('requests an explicitly provided input device', async () => {
        await startAudioRecording('track-explicit', vi.fn(), 'dev-123');

        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                deviceId: { exact: 'dev-123' },
            },
        });
    });
});
