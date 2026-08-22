import { describe, it, expect, vi, beforeEach } from 'vitest';

import { PEER_COLORS, type SignalingMessage } from '../../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { canExecuteCommandBatch } from '../canExecuteCommandBatch';
import { joinSession } from '../joinSession';
import { leaveSession } from '../leaveSession';

/**
 * `joinSession` orchestrates against the WebRTC/signaling boundary exposed
 * by `sessionManagement`'s `sessionRuntimePrimitives`. Mock that boundary
 * entirely so these specs exercise joinSession's own validation and state
 * transitions without opening a real peer connection.
 */
const mockRuntime = vi.hoisted(() => ({
    cleanup: vi.fn<() => void>(),
    initialize: vi.fn<(assetOwnerId: string) => PeerConnectionManager>(),
    startPlayheadBroadcast: vi.fn<() => void>(),
    startBranchSync: vi.fn<(isHost: boolean) => void>(),
    generatePeerId: vi.fn<() => string>(),
    pickPeerColor: vi.fn<(excludeColors: string[]) => string>(),
    compressInvite: vi.fn<(json: string) => Promise<string>>(),
    decompressInvite: vi.fn<(raw: string) => Promise<string>>(),
    state: { peerManager: null },
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));
vi.mock('../getCollaborationAssetOwnerId', () => ({
    getCollaborationAssetOwnerId: () => 'project-owner-1',
}));

type Offer = Extract<SignalingMessage, { type: 'offer' }>;

function makeOffer(overrides: Partial<Offer> = {}): Offer {
    return {
        type: 'offer',
        peerId: 'host-peer',
        name: 'Host',
        sessionId: 'session-1',
        sdp: 'fake-offer-sdp',
        pendingPeerId: 'joiner-1',
        ...overrides,
    };
}

describe('joinSession', () => {
    let acceptOffer: ReturnType<typeof vi.fn>;
    let createPeer: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        collaborationStore.set({
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
        });

        acceptOffer = vi.fn().mockResolvedValue('fake-answer-sdp');
        createPeer = vi.fn().mockReturnValue({ acceptOffer });
        mockRuntime.initialize.mockReturnValue({ createPeer } as unknown as PeerConnectionManager);
        mockRuntime.generatePeerId.mockReturnValue('local-peer-id');
        mockRuntime.pickPeerColor.mockReturnValue(PEER_COLORS[3]);
        mockRuntime.decompressInvite.mockImplementation((raw: string) => Promise.resolve(raw));
        mockRuntime.compressInvite.mockImplementation((json: string) => Promise.resolve(`z:${json}`));
    });

    it('cleans up any prior session runtime even before the invite is validated', async () => {
        await expect(joinSession('', 'Alice')).rejects.toThrow('Invite string is empty');
        expect(mockRuntime.cleanup).toHaveBeenCalledTimes(1);
    });

    it('rejects a whitespace-only invite string', async () => {
        await expect(joinSession('   ', 'Alice')).rejects.toThrow('Invite string is empty');
    });

    it('rejects an invite that fails to decompress', async () => {
        mockRuntime.decompressInvite.mockRejectedValueOnce(new Error('bad payload'));
        await expect(joinSession('garbled', 'Alice')).rejects.toThrow('Invalid invite');
    });

    it('rejects an invite whose payload is not valid JSON', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce('not-json{{');
        await expect(joinSession('whatever', 'Alice')).rejects.toThrow('Invalid invite');
    });

    it('rejects an invite that is not an offer', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify({ type: 'answer' }));
        await expect(joinSession('whatever', 'Alice')).rejects.toThrow('expected offer');
    });

    it('picks a joiner color that excludes the host slot', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeOffer()));

        await joinSession('invite', 'Alice');

        expect(mockRuntime.pickPeerColor).toHaveBeenCalledWith([PEER_COLORS[0]]);
    });

    it('initializes the runtime and starts branch sync as a non-host', async () => {
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeOffer()));

        await joinSession('invite', 'Alice');

        expect(mockRuntime.initialize).toHaveBeenCalledTimes(1);
        expect(mockRuntime.startPlayheadBroadcast).toHaveBeenCalledTimes(1);
        expect(mockRuntime.startBranchSync).toHaveBeenCalledWith(false);
    });

    it('accepts the offer SDP against the host peer id from the invite', async () => {
        const offer = makeOffer({ peerId: 'host-42', sdp: 'offer-sdp-xyz' });
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(offer));

        await joinSession('invite', 'Alice');

        expect(createPeer).toHaveBeenCalledWith('host-42');
        expect(acceptOffer).toHaveBeenCalledWith('offer-sdp-xyz');
    });

    it('revokes command-batch authority before awaiting the host offer', async () => {
        let resolveOffer!: (sdp: string) => void;
        acceptOffer.mockReturnValueOnce(
            new Promise<string>((resolve) => {
                resolveOffer = resolve;
            })
        );
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeOffer()));

        const joining = joinSession('invite', 'Alice');
        await vi.waitFor(() => expect(acceptOffer).toHaveBeenCalledTimes(1));

        expect(canExecuteCommandBatch()).toBe(false);

        resolveOffer('fake-answer-sdp');
        await joining;
    });

    it('restores standalone authority after a failed join tears down its runtime', async () => {
        acceptOffer.mockRejectedValueOnce(new Error('offer rejected'));
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeOffer()));

        await expect(joinSession('invite', 'Alice')).rejects.toThrow('offer rejected');

        expect(mockRuntime.cleanup).toHaveBeenCalledTimes(2);
        expect(canExecuteCommandBatch()).toBe(true);
        expect(collaborationStore.value).toMatchObject({
            connectionStatus: 'error',
            error: 'offer rejected',
            quarantinedPeerIds: [],
            isEnabled: false,
            isHost: false,
        });
    });

    it('does not let a stale join continuation overwrite a completed leave', async () => {
        let resolveInvite!: (invite: string) => void;
        mockRuntime.decompressInvite.mockReturnValueOnce(
            new Promise<string>((resolve) => {
                resolveInvite = resolve;
            })
        );

        const joining = joinSession('invite', 'Alice');
        expect(canExecuteCommandBatch()).toBe(false);
        await leaveSession();
        resolveInvite(JSON.stringify(makeOffer()));

        await expect(joining).rejects.toThrow('Join attempt was superseded');
        expect(collaborationStore.value).toMatchObject({
            connectionStatus: 'disconnected',
            isEnabled: false,
            isHost: false,
        });
        expect(mockRuntime.initialize).not.toHaveBeenCalled();
    });

    it('writes joiner session state to the collaboration store', async () => {
        const offer = makeOffer({ sessionId: 'session-99', peerId: 'host-42', name: 'Host Name' });
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(offer));

        await joinSession('invite', 'Alice');

        const state = collaborationStore.value;
        expect(state).toMatchObject({
            isEnabled: true,
            sessionId: 'session-99',
            localPeerId: 'joiner-1',
            localName: 'Alice',
            localColor: PEER_COLORS[3],
            isHost: false,
            connectionStatus: 'connecting',
            error: null,
            quarantinedPeerIds: [],
        });
        expect(state?.peers).toEqual([
            {
                id: 'host-42',
                name: 'Host Name',
                color: PEER_COLORS[0],
                isHost: true,
                isConnected: false,
                lastSeen: expect.any(Number),
                latencyMs: null,
            },
        ]);
    });

    it('truncates an oversized host name from the invite to the shared identity bound', async () => {
        const offer = makeOffer({ name: 'h'.repeat(200) });
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(offer));

        await joinSession('invite', 'Alice');

        expect(collaborationStore.value?.peers[0]?.name).toBe('h'.repeat(64));
    });

    it('adopts the host-minted pendingPeerId as the joiner identity (regression: dual peer id)', async () => {
        // The host creates the PeerConnection keyed by pendingPeerId and lists
        // the joiner in its store under answer.peerId. If those differ, every
        // cross-layer host lookup (presence, peer-leave, disconnect cleanup,
        // color assignment) silently misses. The joiner must therefore take
        // the host-minted slot id as its own session identity.
        const offer = makeOffer({ pendingPeerId: 'joiner-slot-9' });
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(offer));

        await joinSession('invite', 'Alice');

        expect(collaborationStore.value?.localPeerId).toBe('joiner-slot-9');
        const sentJson = mockRuntime.compressInvite.mock.calls[0]![0];
        const answer = JSON.parse(sentJson) as SignalingMessage;
        expect(answer).toMatchObject({ type: 'answer', peerId: 'joiner-slot-9', pendingPeerId: 'joiner-slot-9' });
    });

    it('falls back to a self-minted id for legacy invites without pendingPeerId', async () => {
        const { pendingPeerId: _omitted, ...legacyOffer } = makeOffer();
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(legacyOffer));

        await joinSession('invite', 'Alice');

        expect(collaborationStore.value?.localPeerId).toBe('local-peer-id');
        expect(mockRuntime.generatePeerId).toHaveBeenCalledTimes(1);
    });

    it('returns a compressed answer addressed to the pending peer slot', async () => {
        const offer = makeOffer({ pendingPeerId: 'pending-7' });
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(offer));

        const result = await joinSession('invite', 'Alice');

        expect(mockRuntime.compressInvite).toHaveBeenCalledTimes(1);
        const sentJson = mockRuntime.compressInvite.mock.calls[0]![0];
        const answer = JSON.parse(sentJson) as SignalingMessage;
        expect(answer).toMatchObject({
            type: 'answer',
            peerId: 'pending-7',
            name: 'Alice',
            sdp: 'fake-answer-sdp',
            pendingPeerId: 'pending-7',
        });
        expect(result).toBe(`z:${sentJson}`);
    });
});
