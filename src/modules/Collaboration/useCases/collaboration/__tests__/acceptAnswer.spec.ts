import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type CollaborationState } from '../../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { acceptAnswer } from '../acceptAnswer';

const mockRuntime = vi.hoisted(() => ({
    state: {
        peerManager: null as PeerConnectionManager | null,
        pendingInviteId: null as string | null,
    },
    decompressInvite: vi.fn<(raw: string) => Promise<string>>(),
    pickPeerColor: vi.fn<(excludeColors: string[]) => string>(),
    captureOwner: vi.fn<() => object | null>(),
    canWrite: vi.fn<(owner: object | null) => boolean>(),
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

const baseState: CollaborationState = {
    isEnabled: true,
    sessionId: 'session-1',
    localPeerId: 'host-local',
    localName: 'Host',
    localColor: '#3b82f6',
    isHost: true,
    peers: [],
    connectionStatus: 'connecting',
    error: null,
    quarantinedPeerIds: [],
};

function makeAnswer(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        type: 'answer',
        peerId: 'joiner-1',
        name: 'Joiner',
        sdp: 'answer-sdp',
        pendingPeerId: 'pending-1',
        ...overrides,
    };
}

describe('acceptAnswer', () => {
    const ownerA = {};
    const ownerB = {};
    let peers: Map<string, { acceptAnswer: ReturnType<typeof vi.fn> }>;
    let getPeer: ReturnType<typeof vi.fn>;
    let rekeyPeer: ReturnType<typeof vi.fn>;
    let removePeer: ReturnType<typeof vi.fn>;
    let acceptAnswerOnPeer: ReturnType<typeof vi.fn>;

    function installPendingPeer(peerId: string): void {
        peers.clear();
        peers.set(peerId, { acceptAnswer: acceptAnswerOnPeer });
        mockRuntime.state.pendingInviteId = peerId;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        collaborationStore.set({ ...baseState, peers: [] });
        acceptAnswerOnPeer = vi.fn().mockResolvedValue(undefined);
        peers = new Map();
        installPendingPeer('pending-1');
        getPeer = vi.fn().mockImplementation((peerId: string) => peers.get(peerId));
        rekeyPeer = vi.fn().mockImplementation((oldPeerId: string, newPeerId: string, localPeerId?: string | null) => {
            const peer = peers.get(oldPeerId);
            if (!peer || oldPeerId === newPeerId || peers.has(newPeerId) || newPeerId === localPeerId) {
                return false;
            }
            peers.delete(oldPeerId);
            peers.set(newPeerId, peer);
            return true;
        });
        removePeer = vi.fn().mockImplementation((peerId: string) => {
            peers.delete(peerId);
        });
        mockRuntime.state.peerManager = {
            getPeer,
            rekeyPeer,
            removePeer,
        } as unknown as PeerConnectionManager;
        mockRuntime.decompressInvite.mockImplementation((raw: string) => Promise.resolve(raw));
        mockRuntime.pickPeerColor.mockReturnValue('#22c55e');
        mockRuntime.captureOwner.mockReturnValue(ownerA);
        mockRuntime.canWrite.mockImplementation((owner) => owner === mockRuntime.captureOwner());
    });

    it('converts a decompression failure into a collaboration error instead of leaking the raw exception', async () => {
        mockRuntime.decompressInvite.mockRejectedValueOnce(new Error('Malformed base64'));
        await expect(acceptAnswer('garbage')).rejects.toThrow('Invalid answer — must be a valid answer string');
    });

    it('converts a JSON parse failure into a collaboration error instead of leaking the raw SyntaxError', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce('not-json{{{');
        await expect(acceptAnswer('garbage')).rejects.toThrow('Invalid answer — must be a valid answer string');
    });

    it('surfaces a malformed-answer failure in the store while preserving the session state', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce('not-json{{{');

        await expect(acceptAnswer('garbage')).rejects.toThrow();

        expect(collaborationStore.value).toEqual({
            ...baseState,
            error: 'Invalid answer — must be a valid answer string',
        });
    });

    it('surfaces a peer-level acceptance failure in the store', async () => {
        acceptAnswerOnPeer.mockRejectedValueOnce(new Error('ICE negotiation failed'));
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        await expect(acceptAnswer('raw')).rejects.toThrow('ICE negotiation failed');

        expect(collaborationStore.value?.error).toBe('ICE negotiation failed');
        expect(collaborationStore.value?.isEnabled).toBe(true);
    });

    it('keeps the store clean when a duplicate concurrent accept rejects after the first succeeded', async () => {
        // A double-clicked accept button: both calls target the same pending
        // peer, the first applies the answer, the second rejects because the
        // connection has left the state that accepts one. The host is connected
        // — nothing may claim the join failed.
        acceptAnswerOnPeer
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('Failed to set remote answer sdp: Called in wrong state: stable'));
        const answer = JSON.stringify(makeAnswer());

        const outcomes = await Promise.allSettled([acceptAnswer(answer), acceptAnswer(answer)]);

        expect(outcomes[0]?.status).toBe('fulfilled');
        expect(outcomes[1]).toMatchObject({
            status: 'rejected',
            reason: expect.objectContaining({ message: expect.stringContaining('superseded') }),
        });
        expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1);
        expect(peers.get('joiner-1')).toBeDefined();
        expect(collaborationStore.value?.error).toBeNull();
    });

    it('clears a previously surfaced failure when a new attempt succeeds', async () => {
        collaborationStore.set({ ...baseState, error: 'Invalid answer — must be a valid answer string' });
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        await acceptAnswer('raw');

        expect(collaborationStore.value?.error).toBeNull();
    });

    it('rejects a payload that is not an answer', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer({ type: 'offer' })));
        await expect(acceptAnswer('raw')).rejects.toThrow('Invalid answer');
    });

    it('rejects when there is no active session runtime', async () => {
        mockRuntime.state.peerManager = null;
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));
        await expect(acceptAnswer('raw')).rejects.toThrow('No active session');
    });

    it('rejects when no pending peer connection matches the answer', async () => {
        getPeer.mockReturnValue(undefined);
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));
        await expect(acceptAnswer('raw')).rejects.toThrow('No pending peer connection');
    });

    it('applies the SDP answer to the matching pending peer', async () => {
        installPendingPeer('pending-7');
        mockRuntime.decompressInvite.mockResolvedValueOnce(
            JSON.stringify(makeAnswer({ pendingPeerId: 'pending-7', sdp: 'sdp-xyz' }))
        );

        await acceptAnswer('raw');

        expect(getPeer).toHaveBeenCalledWith('pending-7');
        expect(acceptAnswerOnPeer).toHaveBeenCalledWith('sdp-xyz');
    });

    it('clears the pending invite id after acceptance', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        await acceptAnswer('raw');

        expect(mockRuntime.state.pendingInviteId).toBeNull();
    });

    it('adds the joiner to the peer list with a color excluding those already in use', async () => {
        collaborationStore.set({
            ...baseState,
            localColor: '#3b82f6',
            peers: [
                {
                    id: 'other',
                    name: 'Other',
                    color: '#ef4444',
                    isHost: false,
                    isConnected: true,
                    lastSeen: 1,
                    latencyMs: null,
                    syncHealth: 'converging',
                },
            ],
        });
        mockRuntime.decompressInvite.mockResolvedValueOnce(
            JSON.stringify(makeAnswer({ peerId: 'joiner-9', name: 'Joiner Nine' }))
        );

        await acceptAnswer('raw');

        expect(mockRuntime.pickPeerColor).toHaveBeenCalledWith(['#3b82f6', '#ef4444']);
        expect(collaborationStore.value?.peers).toEqual([
            {
                id: 'other',
                name: 'Other',
                color: '#ef4444',
                isHost: false,
                isConnected: true,
                lastSeen: 1,
                latencyMs: null,
                syncHealth: 'converging',
            },
            {
                id: 'joiner-9',
                name: 'Joiner Nine',
                color: '#22c55e',
                isHost: false,
                isConnected: false,
                lastSeen: expect.any(Number),
                latencyMs: null,
                syncHealth: 'converging',
            },
        ]);
    });

    it('truncates an oversized joiner name from the answer to the shared identity bound', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer({ name: 'j'.repeat(200) })));

        await acceptAnswer('raw');

        expect(collaborationStore.value?.peers[0]?.name).toBe('j'.repeat(64));
    });

    it('still clears the pending invite id when no session is active in the store', async () => {
        collaborationStore.set(null);
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        await acceptAnswer('raw');

        expect(collaborationStore.value).toBeNull();
        expect(mockRuntime.state.pendingInviteId).toBeNull();
    });

    it('re-keys the peer in peerManager from pendingPeerId to answer.peerId', async () => {
        installPendingPeer('pending-slot-42');
        mockRuntime.decompressInvite.mockResolvedValueOnce(
            JSON.stringify(makeAnswer({ pendingPeerId: 'pending-slot-42', peerId: 'joiner-actual-99' }))
        );

        await acceptAnswer('raw');

        expect(rekeyPeer).toHaveBeenCalledWith('pending-slot-42', 'joiner-actual-99', 'host-local');
    });

    it('rejects answer and closes pending connection if answer.peerId collides with host localPeerId', async () => {
        collaborationStore.set({
            ...baseState,
            localPeerId: 'host-peer-id',
        });
        installPendingPeer('pending-slot-42');
        mockRuntime.decompressInvite.mockResolvedValueOnce(
            JSON.stringify(makeAnswer({ pendingPeerId: 'pending-slot-42', peerId: 'host-peer-id' }))
        );

        await expect(acceptAnswer('raw')).rejects.toThrow('Invalid answer — peer ID is already in use');
        expect(removePeer).toHaveBeenCalledWith('pending-slot-42');
    });

    it('rejects answer and closes pending connection if rekeyPeer fails due to duplicate peer ID', async () => {
        installPendingPeer('pending-slot-42');
        peers.set('duplicate-peer-id', { acceptAnswer: vi.fn() });
        mockRuntime.decompressInvite.mockResolvedValueOnce(
            JSON.stringify(makeAnswer({ pendingPeerId: 'pending-slot-42', peerId: 'duplicate-peer-id' }))
        );

        await expect(acceptAnswer('raw')).rejects.toThrow('Invalid answer — peer ID is already in use');
        expect(removePeer).toHaveBeenCalledWith('pending-slot-42');
    });

    it('does not let decompression from an old session read or overwrite its replacement', async () => {
        const decompression = Promise.withResolvers<string>();
        mockRuntime.decompressInvite.mockReturnValueOnce(decompression.promise);

        const accepting = acceptAnswer('raw');

        const sessionBManager = { getPeer: vi.fn() } as unknown as PeerConnectionManager;
        mockRuntime.captureOwner.mockReturnValue(ownerB);
        mockRuntime.state.peerManager = sessionBManager;
        mockRuntime.state.pendingInviteId = 'session-b-invite';
        collaborationStore.set({ ...baseState, sessionId: 'session-b', localName: 'Session B', error: null });
        decompression.resolve(JSON.stringify(makeAnswer()));

        await expect(accepting).rejects.toThrow('superseded by a newer session');
        expect(mockRuntime.state.peerManager).toBe(sessionBManager);
        expect(sessionBManager.getPeer).not.toHaveBeenCalled();
        expect(mockRuntime.state.pendingInviteId).toBe('session-b-invite');
        expect(collaborationStore.value).toMatchObject({ sessionId: 'session-b', error: null });
    });

    it('does not let SDP acceptance from an old session overwrite its replacement', async () => {
        const sdpAcceptance = Promise.withResolvers<void>();
        acceptAnswerOnPeer.mockReturnValueOnce(sdpAcceptance.promise);
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        const accepting = acceptAnswer('raw');
        await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));

        const sessionBManager = { getPeer: vi.fn() } as unknown as PeerConnectionManager;
        mockRuntime.captureOwner.mockReturnValue(ownerB);
        mockRuntime.state.peerManager = sessionBManager;
        mockRuntime.state.pendingInviteId = 'session-b-invite';
        collaborationStore.set({ ...baseState, sessionId: 'session-b', localName: 'Session B', error: null });
        sdpAcceptance.resolve();

        await expect(accepting).rejects.toThrow('superseded by a newer session');
        expect(mockRuntime.state.peerManager).toBe(sessionBManager);
        expect(mockRuntime.state.pendingInviteId).toBe('session-b-invite');
        expect(collaborationStore.value).toMatchObject({ sessionId: 'session-b', localName: 'Session B', error: null });
    });

    it('preserves live confirmed peer state and a newer pending invite after older SDP acceptance', async () => {
        const sdpAcceptance = Promise.withResolvers<void>();
        acceptAnswerOnPeer.mockReturnValueOnce(sdpAcceptance.promise);
        mockRuntime.state.pendingInviteId = 'pending-1';
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        const accepting = acceptAnswer('raw');
        await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));

        const newerPeer = { acceptAnswer: vi.fn() };
        peers.set('pending-2', newerPeer);
        mockRuntime.state.pendingInviteId = 'pending-2';
        const liveJoiner = {
            id: 'joiner-1',
            name: 'Live Joiner',
            color: '#f59e0b',
            isHost: false,
            isConnected: true,
            lastSeen: 42,
            latencyMs: 18,
            syncHealth: 'diverged' as const,
        };
        const unrelatedPeer = {
            id: 'other-peer',
            name: 'Other',
            color: '#ef4444',
            isHost: false,
            isConnected: true,
            lastSeen: 41,
            latencyMs: 7,
            syncHealth: 'converging' as const,
        };
        collaborationStore.set({
            ...baseState,
            peers: [liveJoiner, unrelatedPeer],
            connectionStatus: 'connected',
            error: 'concurrent warning',
            quarantinedPeerIds: ['joiner-1'],
        });
        sdpAcceptance.resolve();

        await accepting;
        expect(mockRuntime.state.pendingInviteId).toBe('pending-2');
        expect(getPeer('pending-2')).toBe(newerPeer);
        expect(collaborationStore.value).toEqual({
            ...baseState,
            peers: [liveJoiner, unrelatedPeer],
            connectionStatus: 'connected',
            error: 'concurrent warning',
            quarantinedPeerIds: ['joiner-1'],
        });
    });

    it.each(['removed', 'replaced'] as const)(
        'quietly supersedes acceptance when its confirmed peer mapping is %s during SDP',
        async (mappingChange) => {
            const sdpAcceptance = Promise.withResolvers<void>();
            acceptAnswerOnPeer.mockReturnValueOnce(sdpAcceptance.promise);
            mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

            const accepting = acceptAnswer('raw');
            await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));

            if (mappingChange === 'removed') {
                peers.delete('joiner-1');
            } else {
                peers.set('joiner-1', { acceptAnswer: vi.fn() });
            }
            mockRuntime.state.pendingInviteId = 'pending-2';
            const replacementState = {
                ...baseState,
                sessionId: 'session-current',
                error: null,
            };
            collaborationStore.set(replacementState);
            sdpAcceptance.resolve();

            await expect(accepting).rejects.toThrow('superseded');
            expect(mockRuntime.state.pendingInviteId).toBe('pending-2');
            expect(collaborationStore.value).toEqual(replacementState);
        }
    );

    it('marks a newly appended peer diverged when quarantine arrives during SDP acceptance', async () => {
        const sdpAcceptance = Promise.withResolvers<void>();
        acceptAnswerOnPeer.mockReturnValueOnce(sdpAcceptance.promise);
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        const accepting = acceptAnswer('raw');
        await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));
        collaborationStore.set({ ...baseState, quarantinedPeerIds: ['joiner-1'] });
        sdpAcceptance.resolve();

        await accepting;
        expect(collaborationStore.value?.quarantinedPeerIds).toEqual(['joiner-1']);
        expect(collaborationStore.value?.peers).toEqual([
            expect.objectContaining({ id: 'joiner-1', syncHealth: 'diverged' }),
        ]);
    });
});
