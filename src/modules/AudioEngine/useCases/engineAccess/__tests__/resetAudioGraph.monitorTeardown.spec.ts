import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { startInputMonitoring } from '../../../repositories/audioRecorder/inputMonitoring';
import { inputMonitoringSession } from '../../../repositories/audioRecorder/inputMonitoringSession';
import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { resetAudioGraph } from '../resetAudioGraph';

import type { TrackChannelStrip } from '../../../models/AudioEngineState';

type MediaStreamSourceDouble = {
    connect: Mock<(destination: unknown) => void>;
    disconnect: Mock<(...args: unknown[]) => void>;
};

const getUserMedia = vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>();
const originalMediaDevices = globalThis.navigator.mediaDevices;
// The module singleton's context is the setupTests stub, which implements the
// graph factories but no microphone capture; the one call this spec needs is
// provided and removed per case rather than widened in the shared stub.
const context = audioEngine.context as unknown as {
    createMediaStreamSource?: (stream: MediaStream) => MediaStreamAudioSourceNode;
};

function createStream(trackStop: Mock<() => void>): MediaStream {
    return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
}

/**
 * `resetAudioGraph()` is the project-switch path: `newProject` and
 * `replaceProjectData` reach the engine's graph teardown only through it, so a
 * monitor session that survives this call is the leaked microphone #4481
 * reports. Driving the real use case against the real engine singleton keeps the
 * route honest — the strip and the media-stream source are the only doubles.
 */
describe('resetAudioGraph monitor teardown (project-switch path)', () => {
    let source: MediaStreamSourceDouble;
    let stripGain: object;

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        });
        inputMonitoringSession.captures.clear();
        inputMonitoringSession.trackKeys.clear();
        inputMonitoringSession.pendingRequests.clear();
        getUserMedia.mockReset();

        source = { connect: vi.fn(), disconnect: vi.fn() };
        context.createMediaStreamSource = () => source as unknown as MediaStreamAudioSourceNode;
        stripGain = { id: 'strip-gain' };
        vi.spyOn(audioEngine, 'ensureTrackStrip').mockReturnValue({
            gainNode: stripGain,
        } as unknown as TrackChannelStrip);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        delete context.createMediaStreamSource;
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('stops every monitor stream once, drops its strip edge, and empties the session', async () => {
        const trackStop = vi.fn<() => void>();
        getUserMedia.mockResolvedValue(createStream(trackStop));

        await startInputMonitoring('t1');
        expect(source.connect).toHaveBeenCalledWith(stripGain);
        expect(inputMonitoringSession.captures.size).toBe(1);

        resetAudioGraph();

        expect(inputMonitoringSession.captures.size).toBe(0);
        expect(inputMonitoringSession.trackKeys.size).toBe(0);
        expect(inputMonitoringSession.pendingRequests.size).toBe(0);
        expect(trackStop).toHaveBeenCalledTimes(1);
        // The per-track edge releases while the strip node still exists, then the
        // capture-wide disconnect drops anything else the source fed.
        expect(source.disconnect).toHaveBeenCalledWith(stripGain);
        expect(source.disconnect).toHaveBeenCalledWith();
    });

    it('does not stop an already-released stream when the graph resets again', async () => {
        const trackStop = vi.fn<() => void>();
        getUserMedia.mockResolvedValue(createStream(trackStop));

        await startInputMonitoring('t1');
        resetAudioGraph();
        resetAudioGraph();

        expect(trackStop).toHaveBeenCalledTimes(1);
        expect(inputMonitoringSession.captures.size).toBe(0);
    });

    it('releases a grant that settles after the reset and attaches no edge', async () => {
        const grant = Promise.withResolvers<MediaStream>();
        getUserMedia.mockReturnValue(grant.promise);

        const starting = startInputMonitoring('t1', 'input-1');
        expect(inputMonitoringSession.pendingRequests.size).toBe(1);

        resetAudioGraph();
        expect(inputMonitoringSession.pendingRequests.size).toBe(0);

        const lateTrackStop = vi.fn<() => void>();
        grant.resolve(createStream(lateTrackStop));

        // The grant outlived the request its key registered, so it is released
        // instead of adopted: no source node, no strip edge, one stop.
        await expect(starting).resolves.toBe(false);
        expect(source.connect).not.toHaveBeenCalled();
        expect(lateTrackStop).toHaveBeenCalledTimes(1);
        expect(inputMonitoringSession.captures.size).toBe(0);
        expect(inputMonitoringSession.trackKeys.size).toBe(0);
        expect(inputMonitoringSession.pendingRequests.size).toBe(0);
    });
});
