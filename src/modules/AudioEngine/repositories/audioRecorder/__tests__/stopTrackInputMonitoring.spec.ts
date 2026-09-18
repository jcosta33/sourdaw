import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { startInputMonitoring } from '../inputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';
import { stopTrackInputMonitoring } from '../stopTrackInputMonitoring';

type MockMediaStreamTrack = {
    stop: Mock<() => void>;
};

type MockMediaStream = {
    getTracks: Mock<() => MockMediaStreamTrack[]>;
};

type MockMediaStreamAudioSourceNode = {
    connect: Mock<(destination: unknown) => void>;
    disconnect: Mock<(...args: unknown[]) => void>;
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
        disconnect: vi.fn<(...args: unknown[]) => void>(),
    };
}

function createMockStrip(gainNode: unknown = {}): MockTrackStrip {
    return { gainNode };
}

describe('stopTrackInputMonitoring', () => {
    let trackStop: Mock<() => void>;
    let mockSourceNode: MockMediaStreamAudioSourceNode;
    let gainA: { id: string };
    let gainB: { id: string };

    beforeEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: { getUserMedia },
            configurable: true,
        });

        stopInputMonitoring();

        getUserMedia.mockReset();
        createMediaStreamSource.mockReset();
        ensureTrackStrip.mockReset();

        trackStop = vi.fn<() => void>();
        mockSourceNode = createMockSourceNode();
        gainA = { id: 'gain-a' };
        gainB = { id: 'gain-b' };
        getUserMedia.mockResolvedValue(createMockStream([{ stop: trackStop }]));
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockImplementation((trackId: string) => createMockStrip(trackId === 'a' ? gainA : gainB));
    });

    afterEach(() => {
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: originalMediaDevices,
            configurable: true,
        });
    });

    async function listenOnBothTracks(): Promise<void> {
        await startInputMonitoring('a');
        await startInputMonitoring('b');
        mockSourceNode.disconnect.mockClear();
    }

    it('removes only that track’s edge and keeps the shared capture live for the other owner', async () => {
        await listenOnBothTracks();

        stopTrackInputMonitoring('a');

        expect(mockSourceNode.disconnect).toHaveBeenCalledTimes(1);
        expect(mockSourceNode.disconnect).toHaveBeenCalledWith(gainA);
        expect(mockSourceNode.disconnect).not.toHaveBeenCalledWith(gainB);
        expect(trackStop).not.toHaveBeenCalled();

        stopTrackInputMonitoring('b');

        // The last owner releases the shared stream, exactly once.
        expect(mockSourceNode.disconnect).toHaveBeenCalledWith(gainB);
        expect(trackStop).toHaveBeenCalledTimes(1);
    });

    it('treats repeated stops of the same track as a no-op', async () => {
        await listenOnBothTracks();

        stopTrackInputMonitoring('a');
        stopTrackInputMonitoring('a');

        expect(mockSourceNode.disconnect).toHaveBeenCalledTimes(1);
        expect(mockSourceNode.disconnect).toHaveBeenCalledWith(gainA);
        expect(trackStop).not.toHaveBeenCalled();
    });

    it('reacquires fresh capture when a released owner starts listening again', async () => {
        await listenOnBothTracks();
        stopTrackInputMonitoring('a');
        stopTrackInputMonitoring('b');
        expect(trackStop).toHaveBeenCalledTimes(1);

        await startInputMonitoring('a');

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(mockSourceNode.connect).toHaveBeenLastCalledWith(gainA);
    });

    it('leaves a distinct explicit global teardown intact as the separate all-edges path', async () => {
        await listenOnBothTracks();
        stopTrackInputMonitoring('a');
        mockSourceNode.disconnect.mockClear();

        stopInputMonitoring();

        expect(mockSourceNode.disconnect).toHaveBeenCalledWith(gainB);
        expect(mockSourceNode.disconnect).toHaveBeenCalledWith(); // the capture-wide disconnect
        expect(trackStop).toHaveBeenCalledTimes(1);
    });
});
