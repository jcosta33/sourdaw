import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { startInputMonitoring } from '../inputMonitoring';
import { inputMonitoringSession } from '../inputMonitoringSession';
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

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: vi.fn() } }));

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

    it('releases a granted stream and reports a graph connection failure without an unhandled continuation', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const connectionFailure = new Error('Monitor strip unavailable');
        getUserMedia.mockResolvedValue(stream);
        createMediaStreamSource.mockReturnValue(createMockSourceNode());
        ensureTrackStrip.mockImplementation(() => {
            throw connectionFailure;
        });

        expect(await startInputMonitoring('t1')).toBe(false);
        expect(inputMonitoringSession.trackKeys.size).toBe(0);
        expect(inputMonitoringSession.captures.size).toBe(0);
        expect(trackStop).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: connectionFailure }));
    });

    it('releases a current grant and every waiting owner when source creation fails', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const sourceFailure = new Error('Monitor source unavailable');
        const deferred = deferredGrant();
        createMediaStreamSource.mockImplementation(() => {
            throw sourceFailure;
        });
        const first = startInputMonitoring('t1', 'input-1');
        const second = startInputMonitoring('t2', 'input-1');

        deferred.grant(stream);
        await Promise.all([first, second]);

        expect(inputMonitoringSession.pendingRequests.has('input-1')).toBe(false);
        expect(inputMonitoringSession.captures.has('input-1')).toBe(false);
        expect(inputMonitoringSession.trackKeys.size).toBe(0);
        expect(trackStop).toHaveBeenCalledOnce();
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: sourceFailure }));
    });

    it('retains a healthy shared owner when another owner fails graph attachment', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const source = createMockSourceNode();
        const gainA = { id: 'gain-a' };
        const connectionFailure = new Error('Second monitor strip unavailable');
        getUserMedia.mockResolvedValue(stream);
        createMediaStreamSource.mockReturnValue(source);
        ensureTrackStrip.mockImplementation((trackId) => {
            if (trackId === 'b') {
                throw connectionFailure;
            }
            return createMockStrip(gainA);
        });
        const first = startInputMonitoring('a');
        const failed = startInputMonitoring('b');

        expect(await first).toBe(true);
        expect(await failed).toBe(false);
        expect([...inputMonitoringSession.trackKeys.keys()]).toEqual(['a']);
        const capture = inputMonitoringSession.captures.get(null);
        if (!capture) {
            throw new Error('Expected the healthy shared capture');
        }
        expect([...capture.monitorEdges.keys()]).toEqual(['a']);
        expect(source.connect).toHaveBeenCalledWith(gainA);
        expect(source.disconnect).not.toHaveBeenCalled();
        expect(trackStop).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: connectionFailure }));
        stopTrackInputMonitoring('a');
        expect(trackStop).toHaveBeenCalledOnce();
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

    it.each([
        ['one owner', ['t1']],
        ['shared owners', ['t1', 't2']],
    ] as const)(
        'keeps a healthy same-input successor when an orphaned grant stop throws with %s',
        async (_name, owners) => {
            const old = streamWithStoppedTrack();
            const stopFailure = new Error('Outgoing device stop failed');
            old.trackStop.mockImplementation(() => {
                throw stopFailure;
            });
            const oldGrant = deferredGrant();
            const oldOpening = startInputMonitoring('outgoing', 'input-1');
            stopInputMonitoring();

            const successor = streamWithStoppedTrack();
            const source = createMockSourceNode();
            const gains = new Map<string, { id: string }>(
                owners.map((trackId): [string, { id: string }] => [trackId, { id: `gain-${trackId}` }])
            );
            getUserMedia.mockResolvedValueOnce(successor.stream);
            createMediaStreamSource.mockReturnValue(source);
            ensureTrackStrip.mockImplementation((trackId) => createMockStrip(gains.get(trackId)));
            await Promise.all(owners.map((trackId) => startInputMonitoring(trackId, 'input-1')));
            const liveCapture = inputMonitoringSession.captures.get('input-1');
            if (!liveCapture) {
                throw new Error('Expected successor capture');
            }
            expect(liveCapture.monitorStream).toBe(successor.stream);

            oldGrant.grant(old.stream);
            await oldOpening;

            expect(inputMonitoringSession.captures.get('input-1')).toBe(liveCapture);
            expect([...inputMonitoringSession.trackKeys.keys()]).toEqual(owners);
            expect([...liveCapture.monitorEdges.keys()]).toEqual(owners);
            expect(source.disconnect).not.toHaveBeenCalled();
            expect(old.trackStop).toHaveBeenCalledOnce();
            expect(successor.trackStop).not.toHaveBeenCalled();
            expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: stopFailure }));
        }
    );

    it('keeps a newer same-input pending request and its owners when an orphaned grant stop throws', async () => {
        const old = streamWithStoppedTrack();
        const stopFailure = new Error('Outgoing device stop failed');
        old.trackStop.mockImplementation(() => {
            throw stopFailure;
        });
        const oldGrant = deferredGrant();
        const oldOpening = startInputMonitoring('outgoing', 'input-1');
        stopInputMonitoring();

        const newGrant = deferredGrant();
        const newOpening = startInputMonitoring('incoming', 'input-1');
        const pending = inputMonitoringSession.pendingRequests.get('input-1');
        oldGrant.grant(old.stream);
        await oldOpening;

        expect(inputMonitoringSession.pendingRequests.get('input-1')).toBe(pending);
        expect(inputMonitoringSession.trackKeys.get('incoming')).toBe('input-1');
        const successor = streamWithStoppedTrack();
        const source = createMockSourceNode();
        const gain = { id: 'gain-incoming' };
        createMediaStreamSource.mockReturnValue(source);
        ensureTrackStrip.mockReturnValue(createMockStrip(gain));
        newGrant.grant(successor.stream);
        await newOpening;
        expect(inputMonitoringSession.captures.get('input-1')?.monitorStream).toBe(successor.stream);
        expect(source.connect).toHaveBeenCalledWith(gain);
        expect(successor.trackStop).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: stopFailure }));
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

describe('keyed monitor captures', () => {
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

    it('acquires an independent capture per requested input and feeds each edge from its own source', async () => {
        const streamA = createMockStream([], 'stream-a');
        const streamB = createMockStream([], 'stream-b');
        expectDifferentInputs(streamA, streamB);
        const sourceA = createMockSourceNode();
        const sourceB = createMockSourceNode();
        createMediaStreamSource.mockImplementation((stream) => (stream === streamA ? sourceA : sourceB));
        const gainA = { id: 'gain-a' };
        const gainB = { id: 'gain-b' };
        ensureTrackStrip.mockImplementation((trackId) => createMockStrip(trackId === 'a' ? gainA : gainB));

        expect(await startInputMonitoring('a', 'input-1')).toBe(true);
        expect(await startInputMonitoring('b', 'input-2')).toBe(true);

        expect(getUserMedia).toHaveBeenCalledTimes(2);
        expect(deviceIdsRequested()).toEqual(['input-1', 'input-2']);
        expect(createMediaStreamSource).toHaveBeenNthCalledWith(1, streamA);
        expect(createMediaStreamSource).toHaveBeenNthCalledWith(2, streamB);
        expect(sourceA.connect).toHaveBeenCalledTimes(1);
        expect(sourceA.connect).toHaveBeenCalledWith(gainA);
        expect(sourceB.connect).toHaveBeenCalledTimes(1);
        expect(sourceB.connect).toHaveBeenCalledWith(gainB);
    });

    it('shares one acquisition and one source between two tracks naming the same input', async () => {
        const stream = createMockStream([], 'stream');
        getUserMedia.mockResolvedValue(stream);
        const source = createMockSourceNode();
        createMediaStreamSource.mockReturnValue(source);
        const gainA = { id: 'gain-a' };
        const gainB = { id: 'gain-b' };
        ensureTrackStrip.mockImplementation((trackId) => createMockStrip(trackId === 'a' ? gainA : gainB));

        expect(await startInputMonitoring('a', 'input-1')).toBe(true);
        expect(await startInputMonitoring('b', 'input-1')).toBe(true);

        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(createMediaStreamSource).toHaveBeenCalledTimes(1);
        expect(source.connect).toHaveBeenNthCalledWith(1, gainA);
        expect(source.connect).toHaveBeenNthCalledWith(2, gainB);
    });

    it('lands concurrent grants on their own keyed source', async () => {
        const grants = deferredInputs(2);
        const streamA = createMockStream([], 'stream-a');
        const streamB = createMockStream([], 'stream-b');
        const sourceA = createMockSourceNode();
        const sourceB = createMockSourceNode();
        createMediaStreamSource.mockImplementation((stream) => (stream === streamA ? sourceA : sourceB));
        const gainA = { id: 'gain-a' };
        const gainB = { id: 'gain-b' };
        ensureTrackStrip.mockImplementation((trackId) => createMockStrip(trackId === 'a' ? gainA : gainB));

        const startingA = startInputMonitoring('a', 'input-1');
        const startingB = startInputMonitoring('b', 'input-2');
        await Promise.resolve();

        // Both acquisitions are outstanding before either settles.
        expect(deviceIdsRequested()).toEqual(['input-1', 'input-2']);
        grants.grant(0, streamA);
        grants.grant(1, streamB);

        expect(await startingA).toBe(true);
        expect(await startingB).toBe(true);
        expect(sourceA.connect).toHaveBeenCalledWith(gainA);
        expect(sourceA.connect).not.toHaveBeenCalledWith(gainB);
        expect(sourceB.connect).toHaveBeenCalledWith(gainB);
        expect(sourceB.connect).not.toHaveBeenCalledWith(gainA);
    });

    it('releases a late stream exactly once and connects nothing when both owners leave before its grant', async () => {
        const { stream, trackStop } = streamWithStoppedTrack();
        const deferred = deferredGrant();

        const startingA = startInputMonitoring('a', 'input-1');
        const startingB = startInputMonitoring('b', 'input-1');
        await Promise.resolve();
        stopTrackInputMonitoring('a');
        stopTrackInputMonitoring('b');
        deferred.grant(stream);

        expect(await startingA).toBe(false);
        expect(await startingB).toBe(false);
        expect(getUserMedia).toHaveBeenCalledTimes(1);
        expect(createMediaStreamSource).not.toHaveBeenCalled();
        expect(trackStop).toHaveBeenCalledTimes(1);
    });

    it('does not orphan another key pending grant when one key is refused', async () => {
        const grants = deferredInputs(2);
        const streamA = createMockStream([], 'stream-a');
        const sourceA = createMockSourceNode();
        createMediaStreamSource.mockReturnValue(sourceA);
        ensureTrackStrip.mockReturnValue(createMockStrip());

        const startingA = startInputMonitoring('a', 'input-1');
        const startingB = startInputMonitoring('b', 'input-2');
        await Promise.resolve();

        grants.reject(1, new Error('missing device'));
        grants.grant(0, streamA);

        expect(await startingA).toBe(true);
        expect(await startingB).toBe(false);
        expect(sourceA.connect).toHaveBeenCalledTimes(1);
    });

    function expectDifferentInputs(streamA: MockMediaStream, streamB: MockMediaStream): void {
        getUserMedia.mockImplementation((constraints) =>
            Promise.resolve(requestedDeviceId(constraints) === 'input-1' ? streamA : streamB)
        );
    }

    function deviceIdsRequested(): string[] {
        return getUserMedia.mock.calls.map(([constraints]) => requestedDeviceId(constraints) ?? '');
    }

    /** One unresolved getUserMedia per input, so concurrent acquisitions stay outstanding. */
    function deferredInputs(count: number): {
        grant: (index: number, stream: MockMediaStream) => void;
        reject: (index: number, error: Error) => void;
    } {
        const resolvers: Array<(stream: MockMediaStream) => void> = [];
        const rejecters: Array<(error: Error) => void> = [];
        for (let index = 0; index < count; index += 1) {
            getUserMedia.mockReturnValueOnce(
                new Promise<MockMediaStream>((resolve, reject) => {
                    resolvers.push(resolve);
                    rejecters.push(reject);
                })
            );
        }
        return {
            grant: (index, stream) => resolvers[index]?.(stream),
            reject: (index, error) => rejecters[index]?.(error),
        };
    }
});
