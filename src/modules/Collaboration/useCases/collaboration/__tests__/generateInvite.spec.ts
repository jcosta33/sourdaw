import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SignalingMessage } from '../../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { generateInvite } from '../generateInvite';

const mockRuntime = vi.hoisted(() => ({
    state: {
        peerManager: null as PeerConnectionManager | null,
        pendingInviteId: null as string | null,
    },
    generatePeerId: vi.fn<() => string>(),
    compressInvite: vi.fn<(json: string) => Promise<string>>(),
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

describe('generateInvite', () => {
    let removePeer: ReturnType<typeof vi.fn>;
    let createPeer: ReturnType<typeof vi.fn>;
    let createOffer: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRuntime.state.pendingInviteId = null;
        createOffer = vi.fn().mockResolvedValue('fresh-offer-sdp');
        createPeer = vi.fn().mockReturnValue({ createOffer });
        removePeer = vi.fn();
        mockRuntime.state.peerManager = { createPeer, removePeer } as unknown as PeerConnectionManager;
        mockRuntime.generatePeerId.mockReturnValue('joiner-new');
        mockRuntime.compressInvite.mockImplementation((json: string) => Promise.resolve(`z:${json}`));

        collaborationStore.set({
            isEnabled: true,
            sessionId: 'session-42',
            localPeerId: 'host-local',
            localName: 'Host',
            localColor: '#3b82f6',
            isHost: true,
            peers: [],
            connectionStatus: 'disconnected',
            error: null,
        });
    });

    it('rejects when there is no active session runtime', async () => {
        mockRuntime.state.peerManager = null;
        await expect(generateInvite()).rejects.toThrow('No active session');
    });

    it('surfaces a missing-session failure in the store', async () => {
        mockRuntime.state.peerManager = null;

        await expect(generateInvite()).rejects.toThrow('No active session');

        expect(collaborationStore.value?.error).toBe('No active session');
    });

    it('surfaces an offer-creation failure in the store while preserving the session state', async () => {
        createOffer.mockRejectedValueOnce(new Error('WebRTC offer failed'));

        await expect(generateInvite()).rejects.toThrow('WebRTC offer failed');

        expect(collaborationStore.value?.error).toBe('WebRTC offer failed');
        expect(collaborationStore.value?.isEnabled).toBe(true);
        expect(collaborationStore.value?.connectionStatus).toBe('disconnected');
    });

    it('surfaces a compression failure in the store', async () => {
        mockRuntime.compressInvite.mockRejectedValueOnce(new Error('Compression stream failed'));

        await expect(generateInvite()).rejects.toThrow('Compression stream failed');

        expect(collaborationStore.value?.error).toBe('Compression stream failed');
    });

    it('clears a previously surfaced failure when a new attempt succeeds', async () => {
        const state = collaborationStore.value!;
        collaborationStore.set({ ...state, error: 'WebRTC offer failed' });

        await generateInvite();

        expect(collaborationStore.value?.error).toBeNull();
    });

    it('does not remove any peer when there is no stale pending invite', async () => {
        await generateInvite();
        expect(removePeer).not.toHaveBeenCalled();
    });

    it('discards a previously generated, unanswered invite before minting a new one', async () => {
        mockRuntime.state.pendingInviteId = 'stale-joiner';

        await generateInvite();

        expect(removePeer).toHaveBeenCalledWith('stale-joiner');
    });

    it('tracks the freshly generated joiner id as the pending invite', async () => {
        await generateInvite();
        expect(mockRuntime.state.pendingInviteId).toBe('joiner-new');
    });

    it('creates a peer for the new joiner and requests an SDP offer', async () => {
        await generateInvite();

        expect(createPeer).toHaveBeenCalledWith('joiner-new');
        expect(createOffer).toHaveBeenCalledTimes(1);
    });

    it('builds and compresses an offer sourced from the current session state', async () => {
        const result = await generateInvite();

        expect(mockRuntime.compressInvite).toHaveBeenCalledTimes(1);
        const sentJson = mockRuntime.compressInvite.mock.calls[0]![0];
        const invite = JSON.parse(sentJson) as SignalingMessage;
        expect(invite).toEqual({
            type: 'offer',
            peerId: 'host-local',
            name: 'Host',
            sessionId: 'session-42',
            sdp: 'fresh-offer-sdp',
            pendingPeerId: 'joiner-new',
        });
        expect(result).toBe(`z:${sentJson}`);
    });
});
