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

function make_media_stream_source(disconnect: () => void = vi.fn()): MediaStreamAudioSourceNode {
    return {
        context: {} as BaseAudioContext,
        numberOfInputs: 0,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
        connect: vi.fn(),
        disconnect,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
        mediaStream: {} as MediaStream,
    };
}

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
    let media_track_stop: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        media_track_stop = vi.fn();
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockResolvedValue({
                    getTracks: () => [{ stop: media_track_stop }],
                }),
            },
            configurable: true,
        });
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue(make_media_stream_source());
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

    it('should release the shared stream when start fails after microphone acquisition', async () => {
        vi.mocked(audioEngine.context.createMediaStreamSource).mockImplementationOnce(() => {
            throw new Error('source creation failed');
        });

        await expect(startAudioRecording('track-source-fail', vi.fn())).resolves.toBe(false);

        expect(media_track_stop).toHaveBeenCalledTimes(1);
        expect(audioEngine.ensureTrackStrip).not.toHaveBeenCalled();

        await expect(startAudioRecording('track-source-fail', vi.fn())).resolves.toBe(true);
        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    });

    it('cancels a recording start still waiting for microphone access', async () => {
        let grantMicrophone: ((stream: MediaStream) => void) | undefined;
        vi.mocked(globalThis.navigator.mediaDevices.getUserMedia).mockReturnValueOnce(
            new Promise<MediaStream>((resolve) => {
                grantMicrophone = resolve;
            })
        );
        const starting = startAudioRecording('track-pending', vi.fn());

        await Promise.resolve(stopAudioRecording());
        const grant = grantMicrophone;
        if (!grant) {
            throw new Error('Expected microphone request to be pending');
        }
        grant({ getTracks: () => [{ stop: media_track_stop }] } as unknown as MediaStream);

        await expect(starting).resolves.toBe(false);
        expect(audioEngine.ensureTrackStrip).not.toHaveBeenCalled();
        expect(media_track_stop).toHaveBeenCalledOnce();
    });

    it('waits for a stopping session before restarting the same track', async () => {
        await expect(startAudioRecording('track-restart', vi.fn())).resolves.toBe(true);

        const stopping = stopAudioRecording();
        const restarting = startAudioRecording('track-restart', vi.fn());
        await Promise.resolve();

        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(5_000);
        await stopping;

        await expect(restarting).resolves.toBe(true);
        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    });
});
