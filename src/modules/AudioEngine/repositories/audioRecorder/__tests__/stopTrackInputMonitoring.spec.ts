import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { startInputMonitoring } from '../inputMonitoring';
import { stopInputMonitoring } from '../stopInputMonitoring';
import { stopTrackInputMonitoring } from '../stopTrackInputMonitoring';

type MockMediaStreamTrack = {
    stop: Mock<() => void>;
};

type MockMediaStream = {
    id?: string;
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

function createMockStream(tracks: MockMediaStreamTrack[] = [], id?: string): MockMediaStream {
    return { id, getTracks: vi.fn(() => tracks) };
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

describe('stopTrackInputMonitoring on keyed captures', () => {
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

    it('keeps another key monitoring and leaves its stream untouched when the last owner of a different key stops', async () => {
        const streamA = createMockStream([], 'stream-a');
        const streamB = createMockStream([], 'stream-b');
        getUserMedia.mockImplementation((constraints) =>
            Promise.resolve(requestedDeviceId(constraints) === 'input-1' ? streamA : streamB)
        );
        const sourceA = createMockSourceNode();
        const sourceB = createMockSourceNode();
        createMediaStreamSource.mockImplementation((stream) => (stream === streamA ? sourceA : sourceB));
        const gainA = { id: 'gain-a' };
        const gainB = { id: 'gain-b' };
        ensureTrackStrip.mockImplementation((trackId) => createMockStrip(trackId === 'a' ? gainA : gainB));

        await startInputMonitoring('a', 'input-1');
        await startInputMonitoring('b', 'input-2');

        stopTrackInputMonitoring('a');

        // Only key-1's source lost its edge; key-2's capture and stream are untouched.
        expect(sourceA.disconnect).toHaveBeenCalledWith(gainA);
        expect(sourceB.disconnect).not.toHaveBeenCalled();
    });

    it('releases the old key edge and stream when a track moves to another input', async () => {
        const inputOneStop = vi.fn<() => void>();
        const streamA = createMockStream([{ stop: inputOneStop }], 'stream-a');
        const streamB = createMockStream([], 'stream-b');
        getUserMedia.mockImplementation((constraints) =>
            Promise.resolve(requestedDeviceId(constraints) === 'input-1' ? streamA : streamB)
        );
        const sourceA = createMockSourceNode();
        const sourceB = createMockSourceNode();
        createMediaStreamSource.mockImplementation((stream) => (stream === streamA ? sourceA : sourceB));
        const gainA = { id: 'gain-a' };
        ensureTrackStrip.mockReturnValue(createMockStrip(gainA));

        await startInputMonitoring('a', 'input-1');
        await startInputMonitoring('a', 'input-2');

        // The move released key-1's edge and its last owner's stream, then acquired key 2.
        expect(sourceA.disconnect).toHaveBeenCalledWith(gainA);
        expect(inputOneStop).toHaveBeenCalledTimes(1);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(sourceB.connect).toHaveBeenCalledWith(gainA);
    });

    it('refuses a new input for one track without disturbing another key monitoring', async () => {
        const streamA = createMockStream([], 'stream-a');
        getUserMedia.mockImplementation((constraints) => {
            if (requestedDeviceId(constraints) === 'input-1') {
                return Promise.resolve(streamA);
            }
            return Promise.reject(new Error('missing device'));
        });
        const source = createMockSourceNode();
        createMediaStreamSource.mockReturnValue(source);
        const gainA = { id: 'gain-a' };
        ensureTrackStrip.mockReturnValue(createMockStrip(gainA));

        await startInputMonitoring('a', 'input-1');
        source.connect.mockClear();
        source.disconnect.mockClear();

        expect(await startInputMonitoring('b', 'input-2')).toBe(false);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        // No capture exists for the refused key, so no source was built and key 1 stayed connected.
        expect(createMediaStreamSource).toHaveBeenCalledTimes(1);
        expect(source.connect).not.toHaveBeenCalled();
        expect(source.disconnect).not.toHaveBeenCalled();
    });

    it('reports failure when a track moves to a missing device', async () => {
        const streamA = createMockStream([], 'stream-a');
        getUserMedia.mockResolvedValueOnce(streamA);
        getUserMedia.mockRejectedValueOnce(new Error('missing device'));
        const source = createMockSourceNode();
        createMediaStreamSource.mockReturnValue(source);
        const gainA = { id: 'gain-a' };
        ensureTrackStrip.mockReturnValue(createMockStrip(gainA));

        await startInputMonitoring('a', 'input-1');
        source.connect.mockClear();
        source.disconnect.mockClear();

        expect(await startInputMonitoring('a', 'input-2')).toBe(false);
        expect(createMediaStreamSource).toHaveBeenCalledTimes(1);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        // The input change took key-1's edge down and the refusal never re-connected it.
        expect(source.disconnect).toHaveBeenCalledWith(gainA);
        expect(source.connect).not.toHaveBeenCalled();
    });
});
