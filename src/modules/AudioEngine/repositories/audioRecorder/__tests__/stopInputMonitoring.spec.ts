import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { startInputMonitoring } from '../inputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';

type MockMediaStreamTrack = {
    stop: Mock<() => void>;
};

type MockMediaStream = {
    id?: string;
    getTracks: Mock<() => MockMediaStreamTrack[]>;
};

type MockMediaStreamAudioSourceNode = {
    connect: Mock<(destination: unknown) => void>;
    disconnect: Mock<() => void>;
};

type MockTrackStrip = {
    gainNode: unknown;
};

type GetUserMedia = (constraints: MediaStreamConstraints) => Promise<MockMediaStream>;
type CreateMediaStreamSource = (stream: MockMediaStream) => MockMediaStreamAudioSourceNode;
type EnsureTrackStrip = (trackId: string) => MockTrackStrip;

const getUserMedia = vi.hoisted(() => vi.fn<GetUserMedia>());
const createMediaStreamSource = vi.hoisted(() => vi.fn<CreateMediaStreamSource>());
const ensureTrackStrip = vi.hoisted(() => vi.fn<EnsureTrackStrip>());
const originalMediaDevices = globalThis.navigator.mediaDevices;

vi.mock('../../createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            createMediaStreamSource,
        },
        ensureTrackStrip,
    },
}));

function createMockTrack(): MockMediaStreamTrack {
    return { stop: vi.fn<() => void>() };
}

function createMockStream(tracks: MockMediaStreamTrack[] = [], id?: string): MockMediaStream {
    return { id, getTracks: vi.fn(() => tracks) };
}

function createMockSourceNode(): MockMediaStreamAudioSourceNode {
    return {
        connect: vi.fn<(destination: unknown) => void>(),
        disconnect: vi.fn<() => void>(),
    };
}

function createMockStrip(gainNode: unknown = {}): MockTrackStrip {
    return { gainNode };
}

/** The exact deviceId the request named, or undefined for the default device. */
function requestedDeviceId(constraints: MediaStreamConstraints): string | undefined {
    const audio = constraints.audio;
    if (typeof audio !== 'object' || audio.deviceId === undefined) {
        return undefined;
    }
    const deviceId = audio.deviceId;
    if (typeof deviceId !== 'object' || !('exact' in deviceId)) {
        return undefined;
    }
    return typeof deviceId.exact === 'string' ? deviceId.exact : undefined;
}

describe('stopInputMonitoring', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        });

        stopInputMonitoring();

        getUserMedia.mockReset();
        createMediaStreamSource.mockReset();
        ensureTrackStrip.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('should stop monitoring and disconnect nodes', async () => {
        const mockTrack = createMockTrack();
        const mockStream = createMockStream([mockTrack]);
        const mockSourceNode = createMockSourceNode();
        const mockStrip = createMockStrip();

        getUserMedia.mockResolvedValue(mockStream);
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockReturnValue(mockStrip);

        await startInputMonitoring('t1');

        stopInputMonitoring();

        expect(mockSourceNode.disconnect).toHaveBeenCalled();
        expect(mockTrack.stop).toHaveBeenCalled();
    });

    it('should reset the session so a later start creates a new monitor source', async () => {
        const firstMockTrack = createMockTrack();
        const firstMockStream = createMockStream([firstMockTrack]);
        const secondMockStream = createMockStream();
        const firstMockSourceNode = createMockSourceNode();
        const secondMockSourceNode = createMockSourceNode();
        const firstMockStrip = createMockStrip({ id: 'gain-1' });
        const secondMockStrip = createMockStrip({ id: 'gain-2' });

        getUserMedia.mockResolvedValueOnce(firstMockStream).mockResolvedValueOnce(secondMockStream);
        createMediaStreamSource.mockReturnValueOnce(firstMockSourceNode).mockReturnValueOnce(secondMockSourceNode);
        ensureTrackStrip.mockReturnValueOnce(firstMockStrip).mockReturnValueOnce(secondMockStrip);

        await startInputMonitoring('t1');
        stopInputMonitoring();
        await startInputMonitoring('t2');

        // The first source released its per-track edge, then the capture-wide
        // disconnect — and the device track stopped exactly once.
        expect(firstMockSourceNode.disconnect).toHaveBeenCalledWith(firstMockStrip.gainNode);
        expect(firstMockSourceNode.disconnect).toHaveBeenCalledWith();
        expect(firstMockTrack.stop).toHaveBeenCalledTimes(1);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(createMediaStreamSource).toHaveBeenNthCalledWith(2, secondMockStream);
        expect(secondMockSourceNode.connect).toHaveBeenCalledWith(secondMockStrip.gainNode);
    });
});

describe('stopInputMonitoring on keyed captures', () => {
    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        });

        stopInputMonitoring();

        getUserMedia.mockReset();
        createMediaStreamSource.mockReset();
        ensureTrackStrip.mockReset();
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    it('releases every keyed capture and orphans an unresolved grant so it never attaches afterwards', async () => {
        let grantInputOne!: (stream: MockMediaStream) => void;
        getUserMedia.mockImplementationOnce(
            () =>
                new Promise<MockMediaStream>((resolve) => {
                    grantInputOne = resolve;
                })
        );
        const trackStopInputTwo = createMockTrack();
        const streamInputOne = createMockStream([], 'stream-input-1');
        const streamInputTwo = createMockStream([trackStopInputTwo], 'stream-input-2');
        getUserMedia.mockImplementation((constraints) =>
            Promise.resolve(requestedDeviceId(constraints) === 'input-1' ? streamInputOne : streamInputTwo)
        );
        const sourceInputOne = createMockSourceNode();
        const sourceInputTwo = createMockSourceNode();
        createMediaStreamSource.mockImplementation((stream) =>
            stream === streamInputOne ? sourceInputOne : sourceInputTwo
        );
        const gainInputOne = { id: 'gain-input-1' };
        const gainInputTwo = { id: 'gain-input-2' };
        ensureTrackStrip.mockImplementation((trackId) =>
            createMockStrip(trackId === 'a' ? gainInputOne : gainInputTwo)
        );

        const startingInputOne = startInputMonitoring('a', 'input-1');
        await startInputMonitoring('b', 'input-2');

        stopInputMonitoring();

        // Both keyed captures released: their own edge, then the capture-wide disconnect, once each.
        expect(sourceInputTwo.disconnect).toHaveBeenCalledWith(gainInputTwo);
        expect(sourceInputTwo.disconnect).toHaveBeenCalledWith();
        expect(trackStopInputTwo.stop).toHaveBeenCalledTimes(1);
        expect(createMediaStreamSource).toHaveBeenCalledTimes(1);

        // The orphaned grant settles after teardown: one stop, no source, no edge.
        const lateTrackStop = createMockTrack();
        const lateStream = createMockStream([lateTrackStop], 'stream-input-1');
        sourceInputOne.disconnect.mockClear();
        grantInputOne(lateStream);

        expect(await startingInputOne).toBe(false);
        expect(createMediaStreamSource).toHaveBeenCalledTimes(1);
        expect(lateTrackStop.stop).toHaveBeenCalledTimes(1);
        expect(sourceInputOne.connect).not.toHaveBeenCalled();
        expect(sourceInputOne.disconnect).not.toHaveBeenCalled();
    });
});
