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

describe('inputMonitoring', () => {
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

    it('should start input monitoring', async () => {
        const mockStream = createMockStream();
        const mockSourceNode = createMockSourceNode();
        const mockStrip = createMockStrip();

        getUserMedia.mockResolvedValue(mockStream);
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockReturnValue(mockStrip);

        const result = await startInputMonitoring('t1');

        expect(result).toBe(true);
        expect(getUserMedia).toHaveBeenCalledWith({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        expect(createMediaStreamSource).toHaveBeenCalledWith(mockStream);
        expect(ensureTrackStrip).toHaveBeenCalledWith('t1');
        expect(mockSourceNode.connect).toHaveBeenCalledWith(mockStrip.gainNode);
    });

    it('should use explicit device id when provided', async () => {
        const mockStream = createMockStream();
        const mockSourceNode = createMockSourceNode();
        const mockStrip = createMockStrip();

        getUserMedia.mockResolvedValue(mockStream);
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockReturnValue(mockStrip);

        await startInputMonitoring('t1', 'dev-123');

        expect(getUserMedia).toHaveBeenCalledWith({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                deviceId: { exact: 'dev-123' },
            },
        });
    });

    it('should use default-device constraints when input id is null', async () => {
        const mockStream = createMockStream();
        const mockSourceNode = createMockSourceNode();
        const mockStrip = createMockStrip();

        getUserMedia.mockResolvedValue(mockStream);
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockReturnValue(mockStrip);

        await startInputMonitoring('t1', null);

        expect(getUserMedia).toHaveBeenCalledWith({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
    });

    it('should reuse the monitor source when connecting a later track strip', async () => {
        const mockStream = createMockStream();
        const mockSourceNode = createMockSourceNode();
        const firstMockStrip = createMockStrip({ id: 'gain-1' });
        const secondMockStrip = createMockStrip({ id: 'gain-2' });

        getUserMedia.mockResolvedValue(mockStream);
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockReturnValueOnce(firstMockStrip).mockReturnValueOnce(secondMockStrip);

        await startInputMonitoring('t1');
        await startInputMonitoring('t2');

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(createMediaStreamSource).toHaveBeenCalledTimes(1);
        expect(ensureTrackStrip).toHaveBeenNthCalledWith(1, 't1');
        expect(ensureTrackStrip).toHaveBeenNthCalledWith(2, 't2');
        expect(mockSourceNode.connect).toHaveBeenNthCalledWith(1, firstMockStrip.gainNode);
        expect(mockSourceNode.connect).toHaveBeenNthCalledWith(2, secondMockStrip.gainNode);
    });

    it('should return false on getUserMedia failure', async () => {
        getUserMedia.mockRejectedValue(new Error('denied'));
        const result = await startInputMonitoring('t1');
        expect(result).toBe(false);
    });
});
