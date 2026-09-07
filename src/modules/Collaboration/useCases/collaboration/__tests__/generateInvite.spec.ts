import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type SignalingMessage } from '../../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { generateInvite } from '../generateInvite';

const mockRuntime = vi.hoisted(() => ({
    state: {
        peerManager: null as PeerConnectionManager | null,
        pendingInviteId: null as string | null,
        sessionSecret: null as string | null,
    },
    generatePeerId: vi.fn<() => string>(),
    compressInvite: vi.fn<(json: string) => Promise<string>>(),
    captureOwner: vi.fn<() => object | null>(),
    canWrite: vi.fn<(owner: object | null) => boolean>(),
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

describe('generateInvite', () => {
    const ownerA = {};
    const ownerB = {};
    let peers: Map<string, { createOffer: ReturnType<typeof vi.fn> }>;
    let getPeer: ReturnType<typeof vi.fn>;
    let removePeer: ReturnType<typeof vi.fn>;
    let createPeer: ReturnType<typeof vi.fn>;
    let createOffer: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockRuntime.state.pendingInviteId = null;
        mockRuntime.state.sessionSecret = 'room-secret-1';
        peers = new Map();
        createOffer = vi.fn().mockResolvedValue('fresh-offer-sdp');
        createPeer = vi.fn().mockImplementation((peerId: string) => {
            const peer = { createOffer };
            peers.set(peerId, peer);
            return peer;
        });
        getPeer = vi.fn().mockImplementation((peerId: string) => peers.get(peerId));
        removePeer = vi.fn().mockImplementation((peerId: string) => {
            peers.delete(peerId);
        });
        mockRuntime.state.peerManager = { createPeer, getPeer, removePeer } as unknown as PeerConnectionManager;
        mockRuntime.generatePeerId.mockReturnValue('joiner-new');
        mockRuntime.compressInvite.mockImplementation((json: string) => Promise.resolve(`z:${json}`));
        mockRuntime.captureOwner.mockReturnValue(ownerA);
        mockRuntime.canWrite.mockImplementation((owner) => owner === mockRuntime.captureOwner());

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
            quarantinedPeerIds: [],
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

    it('removes only its own pending peer when current offer creation fails', async () => {
        createOffer.mockRejectedValueOnce(new Error('WebRTC offer failed'));

        await expect(generateInvite()).rejects.toThrow('WebRTC offer failed');

        expect(mockRuntime.state.pendingInviteId).toBeNull();
        expect(getPeer('joiner-new')).toBeUndefined();
    });

    it('removes only its own pending peer when current invite compression fails', async () => {
        mockRuntime.compressInvite.mockRejectedValueOnce(new Error('Compression stream failed'));

        await expect(generateInvite()).rejects.toThrow('Compression stream failed');

        expect(mockRuntime.state.pendingInviteId).toBeNull();
        expect(getPeer('joiner-new')).toBeUndefined();
    });

    it('keeps peer-creation setup failures actionable and clears only the reserved slot', async () => {
        const setupError = new Error('Peer construction failed');
        createPeer.mockImplementationOnce(() => {
            throw setupError;
        });

        await expect(generateInvite()).rejects.toBe(setupError);

        expect(mockRuntime.state.pendingInviteId).toBeNull();
        expect(collaborationStore.value?.error).toBe('Peer construction failed');
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
            sessionSecret: 'room-secret-1',
        });
        expect(result).toBe(`z:${sentJson}`);
    });

    it('rejects when the session runtime holds no room secret to hand the joiner', async () => {
        mockRuntime.state.sessionSecret = null;

        await expect(generateInvite()).rejects.toThrow('No active session');
    });

    it('does not let an offer from an old session overwrite its replacement', async () => {
        const offer = Promise.withResolvers<string>();
        createOffer.mockReturnValueOnce(offer.promise);

        const generating = generateInvite();
        await vi.waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));

        const sessionBManager = { createPeer: vi.fn(), removePeer: vi.fn() } as unknown as PeerConnectionManager;
        mockRuntime.captureOwner.mockReturnValue(ownerB);
        mockRuntime.state.peerManager = sessionBManager;
        mockRuntime.state.pendingInviteId = 'session-b-invite';
        mockRuntime.state.sessionSecret = 'session-b-secret';
        collaborationStore.set({
            isEnabled: true,
            sessionId: 'session-b',
            localPeerId: 'session-b-host',
            localName: 'Session B',
            localColor: '#ef4444',
            isHost: true,
            peers: [],
            connectionStatus: 'connected',
            error: null,
            quarantinedPeerIds: [],
        });

        offer.resolve('old-offer');

        await expect(generating).rejects.toThrow('superseded by a newer session');
        expect(mockRuntime.state.peerManager).toBe(sessionBManager);
        expect(mockRuntime.state.pendingInviteId).toBe('session-b-invite');
        expect(collaborationStore.value).toMatchObject({ sessionId: 'session-b', error: null });
    });

    it('does not let compressed invite completion from an old session affect its replacement', async () => {
        const compression = Promise.withResolvers<string>();
        mockRuntime.compressInvite.mockReturnValueOnce(compression.promise);

        const generating = generateInvite();
        await vi.waitFor(() => expect(mockRuntime.compressInvite).toHaveBeenCalledTimes(1));

        const sessionBManager = { createPeer: vi.fn(), removePeer: vi.fn() } as unknown as PeerConnectionManager;
        mockRuntime.captureOwner.mockReturnValue(ownerB);
        mockRuntime.state.peerManager = sessionBManager;
        mockRuntime.state.pendingInviteId = 'session-b-invite';
        collaborationStore.set({ ...collaborationStore.value!, sessionId: 'session-b', error: null });

        compression.resolve('old-compressed-invite');

        await expect(generating).rejects.toThrow('superseded by a newer session');
        expect(mockRuntime.state.peerManager).toBe(sessionBManager);
        expect(mockRuntime.state.pendingInviteId).toBe('session-b-invite');
        expect(collaborationStore.value).toMatchObject({ sessionId: 'session-b', error: null });
    });

    it('does not return an older same-session invite after a newer offer replaces its peer', async () => {
        const oldOffer = Promise.withResolvers<string>();
        createOffer.mockReturnValueOnce(oldOffer.promise).mockResolvedValueOnce('new-offer');
        mockRuntime.generatePeerId.mockReturnValueOnce('joiner-old').mockReturnValueOnce('joiner-new');

        const older = generateInvite();
        await vi.waitFor(() => expect(createOffer).toHaveBeenCalledTimes(1));
        const newer = generateInvite();
        await expect(newer).resolves.toEqual(expect.any(String));
        oldOffer.resolve('old-offer');

        await expect(older).rejects.toThrow('superseded');
        expect(mockRuntime.state.pendingInviteId).toBe('joiner-new');
        expect(getPeer('joiner-old')).toBeUndefined();
        expect(getPeer('joiner-new')).toBeDefined();
    });

    it('does not return an older same-session invite after its compression is superseded', async () => {
        const oldCompression = Promise.withResolvers<string>();
        mockRuntime.compressInvite
            .mockReturnValueOnce(oldCompression.promise)
            .mockImplementationOnce((json: string) => Promise.resolve(`new:${json}`));
        mockRuntime.generatePeerId.mockReturnValueOnce('joiner-old').mockReturnValueOnce('joiner-new');

        const older = generateInvite();
        await vi.waitFor(() => expect(mockRuntime.compressInvite).toHaveBeenCalledTimes(1));
        const newer = generateInvite();
        await expect(newer).resolves.toContain('new:');
        oldCompression.resolve('old-compressed');

        await expect(older).rejects.toThrow('superseded');
        expect(mockRuntime.state.pendingInviteId).toBe('joiner-new');
        expect(getPeer('joiner-old')).toBeUndefined();
        expect(getPeer('joiner-new')).toBeDefined();
    });
});
