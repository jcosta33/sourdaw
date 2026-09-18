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
    let worklet_nodes: Array<{
        port: { postMessage: ReturnType<typeof vi.fn>; onmessage: ((event: { data: unknown }) => void) | null };
        emit: (data: unknown) => void;
    }>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        media_track_stop = vi.fn();
        worklet_nodes = [];
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
                port: {
                    postMessage: ReturnType<typeof vi.fn>;
                    onmessage: ((event: { data: unknown }) => void) | null;
                } = { postMessage: vi.fn(), onmessage: null };
                connect = vi.fn();
                disconnect = vi.fn();
                constructor() {
                    worklet_nodes.push(this);
                }
                emit(data: unknown): void {
                    this.port.onmessage?.({ data });
                }
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

    it('connects the capture source only to the recording worklet, never to the audible strip', async () => {
        const source = make_media_stream_source();
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue(source);

        await expect(startAudioRecording('track-capture-only', vi.fn())).resolves.toBe(true);

        // The session source's only edge is the capture edge into the worklet.
        // The strip is not touched at all: listening edges belong to the
        // input-monitoring repository, which respects the monitoring mode.
        expect(vi.mocked(source.connect).mock.calls.map((call) => call[0])).toEqual([worklet_nodes[0]]);
        expect(audioEngine.ensureTrackStrip).not.toHaveBeenCalled();
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

    it('acquires distinct streams for tracks assigned distinct inputs', async () => {
        const streamA = { getTracks: () => [{ stop: media_track_stop }] } as unknown as MediaStream;
        const streamB = { getTracks: () => [{ stop: media_track_stop }] } as unknown as MediaStream;
        const getUserMedia = vi.mocked(globalThis.navigator.mediaDevices.getUserMedia);
        getUserMedia.mockImplementation((request?: MediaStreamConstraints) => {
            const audio = request?.audio;
            const deviceId = typeof audio === 'object' ? audio.deviceId : undefined;
            const exact =
                typeof deviceId === 'object' && deviceId !== null && !Array.isArray(deviceId)
                    ? deviceId.exact
                    : undefined;
            const selected = exact === 'dev-b' ? streamB : streamA;
            return Promise.resolve(selected);
        });

        await expect(startAudioRecording('track-input-a', vi.fn(), 'dev-a')).resolves.toBe(true);
        await expect(startAudioRecording('track-input-b', vi.fn(), 'dev-b')).resolves.toBe(true);

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        const firstCall = getUserMedia.mock.calls[0];
        const secondCall = getUserMedia.mock.calls[1];
        if (firstCall === undefined || secondCall === undefined) {
            throw new Error('Expected two acquisition calls');
        }
        expect(firstCall[0]?.audio).toEqual({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            deviceId: { exact: 'dev-a' },
        });
        expect(secondCall[0]?.audio).toEqual({
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            deviceId: { exact: 'dev-b' },
        });
        expect(vi.mocked(audioEngine.context.createMediaStreamSource)).toHaveBeenNthCalledWith(1, streamA);
        expect(vi.mocked(audioEngine.context.createMediaStreamSource)).toHaveBeenNthCalledWith(2, streamB);
    });

    it('shares one cached stream across concurrent starts on the same input', async () => {
        let grantMicrophone: ((stream: MediaStream) => void) | undefined;
        vi.mocked(globalThis.navigator.mediaDevices.getUserMedia).mockImplementationOnce(
            () =>
                new Promise<MediaStream>((resolve) => {
                    grantMicrophone = resolve;
                })
        );
        const sharedStream = { getTracks: () => [{ stop: media_track_stop }] } as unknown as MediaStream;

        const first = startAudioRecording('track-same-a', vi.fn(), 'dev-shared');
        const second = startAudioRecording('track-same-b', vi.fn(), 'dev-shared');
        const grant = grantMicrophone;
        if (!grant) {
            throw new Error('Expected a pending microphone request');
        }
        grant(sharedStream);

        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    });

    it('shares one pending microphone request across two concurrent starts', async () => {
        let grantMicrophone: ((stream: MediaStream) => void) | undefined;
        vi.mocked(globalThis.navigator.mediaDevices.getUserMedia).mockImplementationOnce(
            () =>
                new Promise<MediaStream>((resolve) => {
                    grantMicrophone = resolve;
                })
        );
        const sharedStream = { getTracks: () => [{ stop: media_track_stop }] } as unknown as MediaStream;

        const first = startAudioRecording('track-share-a', vi.fn());
        const second = startAudioRecording('track-share-b', vi.fn());

        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
        const grant = grantMicrophone;
        if (!grant) {
            throw new Error('Expected a pending microphone request');
        }
        grant(sharedStream);

        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);
        expect(vi.mocked(audioEngine.context.createMediaStreamSource)).toHaveBeenNthCalledWith(1, sharedStream);
        expect(vi.mocked(audioEngine.context.createMediaStreamSource)).toHaveBeenNthCalledWith(2, sharedStream);
    });

    it('stops the acquired stream exactly once and reacquires fresh when both concurrent sessions end', async () => {
        let grantMicrophone: ((stream: MediaStream) => void) | undefined;
        vi.mocked(globalThis.navigator.mediaDevices.getUserMedia).mockImplementationOnce(
            () =>
                new Promise<MediaStream>((resolve) => {
                    grantMicrophone = resolve;
                })
        );
        const sharedStream = { getTracks: () => [{ stop: media_track_stop }] } as unknown as MediaStream;

        const first = startAudioRecording('track-both-a', vi.fn());
        const second = startAudioRecording('track-both-b', vi.fn());
        const grant = grantMicrophone;
        if (!grant) {
            throw new Error('Expected a pending microphone request');
        }
        grant(sharedStream);

        await expect(first).resolves.toBe(true);
        await expect(second).resolves.toBe(true);

        stopAudioRecording();
        for (const worklet of worklet_nodes) {
            worklet.emit({ type: 'stopped', publishedSampleCount: 0 });
        }
        expect(media_track_stop).toHaveBeenCalledTimes(1);

        await expect(startAudioRecording('track-both-c', vi.fn())).resolves.toBe(true);
        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
    });
});
