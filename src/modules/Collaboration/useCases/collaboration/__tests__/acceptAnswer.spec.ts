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
    let getPeer: ReturnType<typeof vi.fn>;
    let acceptAnswerOnPeer: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        collaborationStore.set({ ...baseState, peers: [] });
        mockRuntime.state.pendingInviteId = 'stale-pending-id';
        acceptAnswerOnPeer = vi.fn().mockResolvedValue(undefined);
        getPeer = vi.fn().mockReturnValue({ acceptAnswer: acceptAnswerOnPeer });
        mockRuntime.state.peerManager = { getPeer } as unknown as PeerConnectionManager;
        mockRuntime.decompressInvite.mockImplementation((raw: string) => Promise.resolve(raw));
        mockRuntime.pickPeerColor.mockReturnValue('#22c55e');
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
            reason: expect.objectContaining({ message: expect.stringContaining('Called in wrong state') }),
        });
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
            },
            {
                id: 'joiner-9',
                name: 'Joiner Nine',
                color: '#22c55e',
                isHost: false,
                isConnected: false,
                lastSeen: expect.any(Number),
                latencyMs: null,
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
});
