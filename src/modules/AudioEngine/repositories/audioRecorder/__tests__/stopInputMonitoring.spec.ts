import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { startInputMonitoring } from '../inputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';

type MockMediaStreamTrack = {
    stop: Mock<() => void>;
};

type MockMediaStream = {
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

function createMockStream(tracks: MockMediaStreamTrack[] = []): MockMediaStream {
    return { getTracks: vi.fn(() => tracks) };
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

        expect(firstMockSourceNode.disconnect).toHaveBeenCalledTimes(1);
        expect(firstMockTrack.stop).toHaveBeenCalledTimes(1);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(createMediaStreamSource).toHaveBeenNthCalledWith(2, secondMockStream);
        expect(secondMockSourceNode.connect).toHaveBeenCalledWith(secondMockStrip.gainNode);
    });
});
