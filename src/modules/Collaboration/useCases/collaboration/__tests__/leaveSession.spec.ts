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
    state: {
        peerManager: null as PeerConnectionManager | null,
    },
    cleanup: vi.fn<() => void>(),
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

const resetStoreShape = {
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
    beforeEach(() => {
        vi.clearAllMocks();
        mockRuntime.state.peerManager = null;
        collaborationStore.set({ ...baseState });
    });

    it('tears down runtime and resets the store even without an active peer manager', async () => {
        await leaveSession();

        expect(mockRuntime.cleanup).toHaveBeenCalledTimes(1);
        expect(collaborationStore.value).toEqual(resetStoreShape);
    });

    it('broadcasts a peer-leave message to every connected peer before tearing down', async () => {
        const sendCrdtSyncBuffered = vi.fn().mockResolvedValue(undefined);
        const getConnectedPeerIds = vi.fn().mockReturnValue(['p1', 'p2']);
        mockRuntime.state.peerManager = {
            sendCrdtSyncBuffered,
            getConnectedPeerIds,
        } as unknown as PeerConnectionManager;

        await leaveSession();

        expect(sendCrdtSyncBuffered).toHaveBeenCalledWith({
            peerId: 'p1',
            message: { type: 'peer-leave', peerId: 'me' },
        });
        expect(sendCrdtSyncBuffered).toHaveBeenCalledWith({
            peerId: 'p2',
            message: { type: 'peer-leave', peerId: 'me' },
        });
        expect(mockRuntime.cleanup).toHaveBeenCalledTimes(1);
        expect(collaborationStore.value).toEqual(resetStoreShape);
    });

    it('falls back to an empty peer id in the leave message when the store has no local peer', async () => {
        collaborationStore.set(null);
        const sendCrdtSyncBuffered = vi.fn().mockResolvedValue(undefined);
        mockRuntime.state.peerManager = {
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
        mockRuntime.state.peerManager = {
            sendCrdtSyncBuffered,
            getConnectedPeerIds: vi.fn().mockReturnValue(['broken', 'ok']),
        } as unknown as PeerConnectionManager;

        await expect(leaveSession()).resolves.toBeUndefined();

        expect(sendCrdtSyncBuffered).toHaveBeenCalledTimes(2);
        expect(collaborationStore.value).toEqual(resetStoreShape);
    });
});
