import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type CollaborationState } from '../../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { leaveSession } from '../leaveSession';

/**
 * `leaveSession` orchestrates against the WebRTC/signaling boundary exposed
 * by `sessionManagement`'s `sessionRuntimePrimitives`. Mock that boundary
 * entirely so these specs exercise leaveSession's own flush-then-teardown
 * orchestration without opening a real peer connection.
 */
const mockRuntime = vi.hoisted(() => ({
    captureOwner: vi.fn<() => object | null>(),
    canWrite: vi.fn<(owner: object | null) => boolean>(),
    retire: vi.fn<(owner: object | null) => void>(),
    cleanup:
        vi.fn<(owner?: object | null, requestWitness?: number, options?: { closeTransport?: boolean }) => boolean>(),
    closeTransport: vi.fn<(owner: object | null) => void>(),
    settleRetainedTeardown: vi.fn<() => Promise<void>>(),
    runLifecycle: vi.fn(<T>(operation: () => Promise<T>) => operation()),
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

const baseState: CollaborationState = {
    isEnabled: true,
    sessionId: 'session-1',
    localPeerId: 'me',
    localName: 'Alice',
    localColor: '#3b82f6',
    isHost: false,
    peers: [],
    connectionStatus: 'connected',
    error: null,
    quarantinedPeerIds: [],
};

const resetStoreShape: CollaborationState = {
    isEnabled: false,
    sessionId: null,
    localPeerId: null,
    localName: '',
    localColor: '',
    isHost: false,
    peers: [],
    connectionStatus: 'disconnected',
    error: null,
    quarantinedPeerIds: [],
};

describe('leaveSession', () => {
    let owner: { peerManager?: PeerConnectionManager };

    beforeEach(() => {
        vi.clearAllMocks();
        owner = {};
        mockRuntime.captureOwner.mockReturnValue(owner);
        mockRuntime.canWrite.mockReturnValue(true);
        mockRuntime.cleanup.mockReturnValue(true);
        mockRuntime.settleRetainedTeardown.mockResolvedValue(undefined);
        collaborationStore.set({ ...baseState });
    });

    it('tears down runtime and resets the store even without an active peer manager', async () => {
        mockRuntime.captureOwner.mockReturnValue(null);
        await leaveSession();

        expect(mockRuntime.cleanup).toHaveBeenCalledExactlyOnceWith(null, expect.any(Number), {
            closeTransport: false,
        });
        expect(collaborationStore.value).toEqual(resetStoreShape);
    });

    it('leaves a completed teardown alone when there is no runtime or pending join', async () => {
        mockRuntime.captureOwner.mockReturnValue(null);
        collaborationStore.set({ ...resetStoreShape, error: 'cleanup failed' });

        await leaveSession();

        expect(mockRuntime.retire).not.toHaveBeenCalled();
        expect(mockRuntime.cleanup).not.toHaveBeenCalled();
        expect(mockRuntime.settleRetainedTeardown).toHaveBeenCalledOnce();
        expect(collaborationStore.value).toEqual({ ...resetStoreShape, error: 'cleanup failed' });
    });

    it('reuses the active teardown witness when the installed owner is already retired', async () => {
        mockRuntime.canWrite.mockReturnValue(false);
        mockRuntime.cleanup.mockReturnValue(false);

        await leaveSession();
        await leaveSession();

        const firstWitness = mockRuntime.cleanup.mock.calls[0]?.[1];
        expect(firstWitness).toEqual(expect.any(Number));
        expect(mockRuntime.cleanup).toHaveBeenNthCalledWith(1, owner, firstWitness, { closeTransport: false });
        expect(mockRuntime.cleanup).toHaveBeenNthCalledWith(2, owner, firstWitness, { closeTransport: false });
    });

    it('broadcasts a peer-leave message to every connected peer before tearing down', async () => {
        const sendCrdtSyncBuffered = vi.fn().mockResolvedValue(undefined);
        const getConnectedPeerIds = vi.fn().mockReturnValue(['p1', 'p2']);
        owner.peerManager = {
            sendCrdtSyncBuffered,
            getConnectedPeerIds,
        } as unknown as PeerConnectionManager;

        await leaveSession();

        expect(mockRuntime.retire).toHaveBeenCalledExactlyOnceWith(owner);
        expect(sendCrdtSyncBuffered).toHaveBeenCalledWith({
            peerId: 'p1',
            message: { type: 'peer-leave', peerId: 'me' },
        });
        expect(sendCrdtSyncBuffered).toHaveBeenCalledWith({
            peerId: 'p2',
            message: { type: 'peer-leave', peerId: 'me' },
        });
        expect(mockRuntime.closeTransport).toHaveBeenCalledExactlyOnceWith(owner);
        expect(mockRuntime.cleanup).toHaveBeenCalledWith(owner, expect.any(Number), { closeTransport: false });
        expect(collaborationStore.value).toEqual(resetStoreShape);
    });

    it('falls back to an empty peer id in the leave message when the store has no local peer', async () => {
        collaborationStore.set(null);
        const sendCrdtSyncBuffered = vi.fn().mockResolvedValue(undefined);
        owner.peerManager = {
            sendCrdtSyncBuffered,
            getConnectedPeerIds: vi.fn().mockReturnValue(['p1']),
        } as unknown as PeerConnectionManager;

        await leaveSession();

        expect(sendCrdtSyncBuffered).toHaveBeenCalledWith({
            peerId: 'p1',
            message: { type: 'peer-leave', peerId: '' },
        });
    });

    it('tolerates a peer whose flush rejects, so the remaining peers still get torn down', async () => {
        const sendCrdtSyncBuffered = vi
            .fn()
            .mockRejectedValueOnce(new Error('channel closed'))
            .mockResolvedValueOnce(undefined);
        owner.peerManager = {
            sendCrdtSyncBuffered,
            getConnectedPeerIds: vi.fn().mockReturnValue(['broken', 'ok']),
        } as unknown as PeerConnectionManager;

        await expect(leaveSession()).resolves.toBeUndefined();

        expect(sendCrdtSyncBuffered).toHaveBeenCalledTimes(2);
        expect(collaborationStore.value).toEqual(resetStoreShape);
    });

    it('does not reset the store when its captured runtime has already been replaced', async () => {
        mockRuntime.cleanup.mockReturnValue(false);

        await leaveSession();

        expect(collaborationStore.value).toEqual(baseState);
    });

    it('closes the outgoing transport before awaiting and propagating durable teardown', async () => {
        const teardownEntered = Promise.withResolvers<void>();
        const teardown = Promise.withResolvers<void>();
        mockRuntime.settleRetainedTeardown.mockImplementationOnce(async () => {
            teardownEntered.resolve();
            await teardown.promise;
        });
        owner.peerManager = {
            sendCrdtSyncBuffered: vi.fn().mockResolvedValue(undefined),
            getConnectedPeerIds: vi.fn().mockReturnValue(['peer']),
        } as unknown as PeerConnectionManager;

        const leaving = leaveSession();
        await teardownEntered.promise;
        expect(mockRuntime.closeTransport).toHaveBeenCalledExactlyOnceWith(owner);

        const failure = new Error('durable teardown failed');
        teardown.reject(failure);
        await expect(leaving).rejects.toBe(failure);
    });
});
