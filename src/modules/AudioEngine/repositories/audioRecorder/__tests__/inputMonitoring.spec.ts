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

/** A stream whose single device track records every stop request. */
function streamWithStoppedTrack(): { stream: MockMediaStream; trackStop: Mock<() => void> } {
    const trackStop = vi.fn<() => void>();
    return { stream: createMockStream([{ stop: trackStop }]), trackStop };
}

/** Seeds one still-unsettled getUserMedia whose grant the test controls. */
function deferredGrant(): {
    grant: (stream: MockMediaStream) => void;
    reject: (error: Error) => void;
} {
    let resolveRequest!: (stream: MockMediaStream) => void;
    let rejectRequest!: (error: Error) => void;
    getUserMedia.mockReturnValueOnce(
        new Promise<MockMediaStream>((resolve, reject) => {
            resolveRequest = resolve;
            rejectRequest = reject;
        })
    );
    return {
        grant: (stream) => resolveRequest(stream),
        reject: (error) => rejectRequest(error),
    };
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

    it('re-ensures an existing edge against HMR strip replacement on a later start', async () => {
        const mockStream = createMockStream();
        const mockSourceNode = createMockSourceNode();
        const firstStrip = createMockStrip({ id: 'gain-1' });
        const replacementStrip = createMockStrip({ id: 'gain-2' });

        getUserMedia.mockResolvedValue(mockStream);
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockReturnValueOnce(firstStrip);

        await startInputMonitoring('t1');
        ensureTrackStrip.mockReturnValue(replacementStrip);
        await startInputMonitoring('t1');

        expect(mockSourceNode.disconnect).toHaveBeenCalledWith(firstStrip.gainNode);
        expect(mockSourceNode.connect).toHaveBeenLastCalledWith(replacementStrip.gainNode);
    });
});

describe('pending monitor capture ownership', () => {
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

    it('releases a late grant exactly once without any monitor edge when the only interested track stops first', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const deferred = deferredGrant();

        const starting = startInputMonitoring('a');
        await Promise.resolve();
        stopTrackInputMonitoring('a');
        deferred.grant(stream);

        expect(await starting).toBe(false);
        expect(createMediaStreamSource).not.toHaveBeenCalled();
        expect(trackStop).toHaveBeenCalledTimes(1);
    });

    it('connects only remaining owners when one track stops during a shared pending grant', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const mockSourceNode = createMockSourceNode();
        const gainA = { id: 'gain-a' };
        const gainB = { id: 'gain-b' };
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockImplementation((trackId: string) => createMockStrip(trackId === 'a' ? gainA : gainB));
        const deferred = deferredGrant();

        const startingA = startInputMonitoring('a');
        const startingB = startInputMonitoring('b');
        await Promise.resolve();
        stopTrackInputMonitoring('a');
        deferred.grant(stream);

        expect(await startingA).toBe(false);
        expect(await startingB).toBe(true);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(mockSourceNode.connect).toHaveBeenCalledTimes(1);
        expect(mockSourceNode.connect).toHaveBeenCalledWith(gainB);
        expect(trackStop).not.toHaveBeenCalled();
    });

    it('serves a newer On for the same track from the still-pending grant without duplicating the edge', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const mockSourceNode = createMockSourceNode();
        const gainA = { id: 'gain-a' };
        createMediaStreamSource.mockReturnValue(mockSourceNode);
        ensureTrackStrip.mockReturnValue(createMockStrip(gainA));
        const deferred = deferredGrant();

        const superseded = startInputMonitoring('a');
        await Promise.resolve();
        stopTrackInputMonitoring('a');
        const readmitted = startInputMonitoring('a');
        await Promise.resolve();
        deferred.grant(stream);

        // The result reports the track's state, not the call's identity: an
        // identical newer start for the same track owns the resolved grant.
        expect(await superseded).toBe(true);
        expect(await readmitted).toBe(true);
        expect(mockSourceNode.connect).toHaveBeenCalledTimes(1);
        expect(mockSourceNode.connect).toHaveBeenCalledWith(gainA);
        expect(trackStop).not.toHaveBeenCalled();
    });

    it('does not resurrect the monitor when the re-admitted track stops again before the grant resolves', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const deferred = deferredGrant();

        const first = startInputMonitoring('a');
        await Promise.resolve();
        stopTrackInputMonitoring('a');
        const readmitted = startInputMonitoring('a');
        await Promise.resolve();
        stopTrackInputMonitoring('a');
        deferred.grant(stream);

        expect(await first).toBe(false);
        expect(await readmitted).toBe(false);
        expect(createMediaStreamSource).not.toHaveBeenCalled();
        expect(trackStop).toHaveBeenCalledTimes(1);
    });

    it('releases the late stream when a global teardown orphans the pending grant, then starts fresh', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const deferred = deferredGrant();

        const starting = startInputMonitoring('a');
        await Promise.resolve();
        stopInputMonitoring();
        deferred.grant(stream);

        expect(await starting).toBe(false);
        expect(createMediaStreamSource).not.toHaveBeenCalled();
        expect(trackStop).toHaveBeenCalledTimes(1);

        const retry = streamWithStoppedTrack();
        getUserMedia.mockResolvedValueOnce(retry.stream);
        createMediaStreamSource.mockReturnValue(createMockSourceNode());
        ensureTrackStrip.mockReturnValue(createMockStrip());

        expect(await startInputMonitoring('b')).toBe(true);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(retry.trackStop).not.toHaveBeenCalled();
    });

    it('resolves false for abandoned owners when the pending grant is rejected and stays usable', async () => {
        const deferred = deferredGrant();
        const startingA = startInputMonitoring('a');
        const startingB = startInputMonitoring('b');
        await Promise.resolve();
        stopTrackInputMonitoring('a');
        deferred.reject(new Error('denied'));

        expect(await startingA).toBe(false);
        expect(await startingB).toBe(false);
        expect(createMediaStreamSource).not.toHaveBeenCalled();

        const retry = streamWithStoppedTrack();
        getUserMedia.mockResolvedValueOnce(retry.stream);
        createMediaStreamSource.mockReturnValue(createMockSourceNode());
        ensureTrackStrip.mockReturnValue(createMockStrip());

        expect(await startInputMonitoring('c')).toBe(true);
        expect(getUserMedia).toHaveBeenCalledTimes(2);
    });
});
