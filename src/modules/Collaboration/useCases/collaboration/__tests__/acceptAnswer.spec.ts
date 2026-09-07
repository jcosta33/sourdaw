import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type CollaborationState } from '../../../models/CollaborationTypes';
import { collaborationStore } from '../../../stores/collaborationStore';
import { acceptAnswer } from '../acceptAnswer';

type AnswerPeer = {
    acceptAnswer: (sdp: string) => Promise<void>;
};

type AnswerPeerManager = {
    getPeer: (peerId: string) => AnswerPeer | undefined;
    rekeyPeer: (oldPeerId: string, newPeerId: string, localPeerId?: string | null) => boolean;
    removePeer: (peerId: string) => void;
};

const mockRuntime = vi.hoisted(() => {
    const state: {
        peerManager: AnswerPeerManager | null;
        pendingInviteId: string | null;
    } = {
        peerManager: null,
        pendingInviteId: null,
    };
    return {
        state,
        decompressInvite: vi.fn<(raw: string) => Promise<string>>(),
        pickPeerColor: vi.fn<(excludeColors: string[]) => string>(),
        captureOwner: vi.fn<() => object | null>(),
        canWrite: vi.fn<(owner: object | null) => boolean>(),
    };
});

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
    let peers: Map<string, AnswerPeer>;
    let getPeer: AnswerPeerManager['getPeer'];
    let getPeerCalls: string[];
    let rekeyPeer: ReturnType<typeof vi.fn<AnswerPeerManager['rekeyPeer']>>;
    let removePeer: ReturnType<typeof vi.fn<AnswerPeerManager['removePeer']>>;
    let acceptAnswerOnPeer: ReturnType<typeof vi.fn<AnswerPeer['acceptAnswer']>>;

    function installPendingPeer(peerId: string): void {
        peers.clear();
        peers.set(peerId, { acceptAnswer: acceptAnswerOnPeer });
        mockRuntime.state.pendingInviteId = peerId;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        collaborationStore.set({ ...baseState, peers: [] });
        acceptAnswerOnPeer = vi.fn<AnswerPeer['acceptAnswer']>().mockResolvedValue(undefined);
        peers = new Map();
        getPeerCalls = [];
        installPendingPeer('pending-1');
        getPeer = (peerId) => {
            getPeerCalls.push(peerId);
            return peers.get(peerId);
        };
        rekeyPeer = vi.fn<AnswerPeerManager['rekeyPeer']>().mockImplementation((oldPeerId, newPeerId, localPeerId) => {
            const peer = peers.get(oldPeerId);
            if (!peer || oldPeerId === newPeerId || peers.has(newPeerId) || newPeerId === localPeerId) {
                return false;
            }
            peers.delete(oldPeerId);
            peers.set(newPeerId, peer);
            return true;
        });
        removePeer = vi.fn<AnswerPeerManager['removePeer']>().mockImplementation((peerId) => {
            peers.delete(peerId);
        });
        mockRuntime.state.peerManager = { getPeer, rekeyPeer, removePeer };
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
        peers.clear();
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));
        await expect(acceptAnswer('raw')).rejects.toThrow('No pending peer connection');
    });

    it('applies the SDP answer to the matching pending peer', async () => {
        installPendingPeer('pending-7');
        mockRuntime.decompressInvite.mockResolvedValueOnce(
            JSON.stringify(makeAnswer({ pendingPeerId: 'pending-7', sdp: 'sdp-xyz' }))
        );

        await acceptAnswer('raw');

        expect(getPeerCalls).toContain('pending-7');
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
        peers.set('duplicate-peer-id', { acceptAnswer: vi.fn<AnswerPeer['acceptAnswer']>() });
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

        const sessionBGetPeer = vi.fn<AnswerPeerManager['getPeer']>();
        const sessionBManager: AnswerPeerManager = {
            getPeer: sessionBGetPeer,
            rekeyPeer: () => false,
            removePeer: () => undefined,
        };
        mockRuntime.captureOwner.mockReturnValue(ownerB);
        mockRuntime.state.peerManager = sessionBManager;
        mockRuntime.state.pendingInviteId = 'session-b-invite';
        collaborationStore.set({ ...baseState, sessionId: 'session-b', localName: 'Session B', error: null });
        decompression.resolve(JSON.stringify(makeAnswer()));

        await expect(accepting).rejects.toThrow('superseded by a newer session');
        expect(mockRuntime.state.peerManager).toBe(sessionBManager);
        expect(sessionBGetPeer).not.toHaveBeenCalled();
        expect(mockRuntime.state.pendingInviteId).toBe('session-b-invite');
        expect(collaborationStore.value).toMatchObject({ sessionId: 'session-b', error: null });
    });

    it('does not let SDP acceptance from an old session overwrite its replacement', async () => {
        const sdpAcceptance = Promise.withResolvers<void>();
        acceptAnswerOnPeer.mockReturnValueOnce(sdpAcceptance.promise);
        mockRuntime.decompressInvite.mockResolvedValueOnce(JSON.stringify(makeAnswer()));

        const accepting = acceptAnswer('raw');
        await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));

        const sessionBManager: AnswerPeerManager = {
            getPeer: () => undefined,
            rekeyPeer: () => false,
            removePeer: () => undefined,
        };
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

        const newerPeer: AnswerPeer = { acceptAnswer: vi.fn<AnswerPeer['acceptAnswer']>() };
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
                peers.set('joiner-1', { acceptAnswer: vi.fn<AnswerPeer['acceptAnswer']>() });
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

    it.each(['removed', 'replaced'] as const)(
        'supersedes a %s confirmed mapping when deferred SDP rejects',
        async (mappingChange) => {
            const sdpAcceptance = Promise.withResolvers<void>();
            acceptAnswerOnPeer.mockReturnValueOnce(sdpAcceptance.promise);

            const accepting = acceptAnswer(JSON.stringify(makeAnswer()));
            const settled = Promise.allSettled([accepting]);
            await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));

            if (mappingChange === 'removed') {
                peers.delete('joiner-1');
            } else {
                peers.set('joiner-1', { acceptAnswer: vi.fn<AnswerPeer['acceptAnswer']>() });
            }
            mockRuntime.state.pendingInviteId = 'pending-2';
            const replacementState = { ...baseState, error: 'current error' };
            collaborationStore.set(replacementState);
            sdpAcceptance.reject(new Error('retired SDP failure'));

            const [result] = await settled;
            expect({
                result,
                pendingInviteId: mockRuntime.state.pendingInviteId,
                state: collaborationStore.value,
            }).toEqual({
                result: expect.objectContaining({
                    status: 'rejected',
                    reason: expect.objectContaining({ message: expect.stringContaining('superseded') }),
                }),
                pendingInviteId: 'pending-2',
                state: replacementState,
            });
        }
    );

    it.each([
        ['rejects', (decompression: PromiseWithResolvers<string>) => decompression.reject(new Error('retired decode'))],
        [
            'resolves invalid JSON',
            (decompression: PromiseWithResolvers<string>) => decompression.resolve('not-json{{{'),
        ],
    ])(
        'supersedes when decompression %s after the pending peer is replaced',
        async (_resolution, finishDecompression) => {
            const decompression = Promise.withResolvers<string>();
            mockRuntime.decompressInvite.mockReturnValueOnce(decompression.promise);

            const accepting = acceptAnswer('raw');
            const settled = Promise.allSettled([accepting]);
            const successorPeer: AnswerPeer = { acceptAnswer: vi.fn<AnswerPeer['acceptAnswer']>() };
            peers.set('pending-1', successorPeer);
            peers.set('pending-2', successorPeer);
            mockRuntime.state.pendingInviteId = 'pending-2';
            const successorState = { ...baseState, error: 'successor error' };
            collaborationStore.set(successorState);
            finishDecompression(decompression);

            const [result] = await settled;
            expect({
                result,
                pendingInviteId: mockRuntime.state.pendingInviteId,
                state: collaborationStore.value,
            }).toEqual({
                result: expect.objectContaining({
                    status: 'rejected',
                    reason: expect.objectContaining({ message: expect.stringContaining('superseded') }),
                }),
                pendingInviteId: 'pending-2',
                state: successorState,
            });
        }
    );

    it('keeps a successful rekeyed acceptance clean after a later expired duplicate', async () => {
        const sdpAcceptance = Promise.withResolvers<void>();
        acceptAnswerOnPeer.mockReturnValueOnce(sdpAcceptance.promise);
        const answer = JSON.stringify(makeAnswer());

        const first = acceptAnswer(answer);
        const firstSettled = Promise.allSettled([first]);
        await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));

        const duplicate = acceptAnswer(answer);
        const duplicateSettled = Promise.allSettled([duplicate]);
        const [duplicateResult] = await duplicateSettled;
        sdpAcceptance.resolve();
        const [firstResult] = await firstSettled;

        expect({ firstResult, duplicateResult, peerIds: [...peers.keys()], state: collaborationStore.value }).toEqual({
            firstResult: expect.objectContaining({ status: 'fulfilled' }),
            duplicateResult: expect.objectContaining({
                status: 'rejected',
                reason: expect.objectContaining({ message: expect.stringContaining('superseded') }),
            }),
            peerIds: ['joiner-1'],
            state: expect.objectContaining({
                error: null,
                peers: [expect.objectContaining({ id: 'joiner-1' })],
            }),
        });
    });

    it('surfaces the sole concurrent SDP failure', async () => {
        const sdpError = new Error('sole SDP failure');
        acceptAnswerOnPeer.mockRejectedValueOnce(sdpError);
        const answer = JSON.stringify(makeAnswer());

        const first = acceptAnswer(answer);
        const second = acceptAnswer(answer);
        const [firstResult, secondResult] = await Promise.allSettled([first, second]);

        expect({
            calls: acceptAnswerOnPeer.mock.calls.length,
            firstResult,
            secondResult,
            state: collaborationStore.value,
        }).toEqual({
            calls: 1,
            firstResult: expect.objectContaining({
                status: 'rejected',
                reason: sdpError,
            }),
            secondResult: expect.objectContaining({
                status: 'rejected',
                reason: expect.objectContaining({ message: expect.stringContaining('superseded') }),
            }),
            state: expect.objectContaining({ error: 'sole SDP failure' }),
        });
    });

    it('admits a later explicit acceptance after a failed call releases its record', async () => {
        acceptAnswerOnPeer.mockRejectedValueOnce(new Error('first SDP failure'));
        await expect(acceptAnswer(JSON.stringify(makeAnswer()))).rejects.toThrow('first SDP failure');

        const retryPeer: AnswerPeer = {
            acceptAnswer: vi.fn<AnswerPeer['acceptAnswer']>().mockResolvedValue(undefined),
        };
        peers.clear();
        peers.set('pending-retry', retryPeer);
        mockRuntime.state.pendingInviteId = 'pending-retry';

        await expect(
            acceptAnswer(JSON.stringify(makeAnswer({ pendingPeerId: 'pending-retry', peerId: 'joiner-retry' })))
        ).resolves.toBeUndefined();
        expect(retryPeer.acceptAnswer).toHaveBeenCalledTimes(1);
        expect(collaborationStore.value?.error).toBeNull();
    });

    it('keeps a newer distinct acceptance failure visible after an older peer succeeds', async () => {
        const firstSdp = Promise.withResolvers<void>();
        acceptAnswerOnPeer.mockReturnValueOnce(firstSdp.promise);
        const first = acceptAnswer(JSON.stringify(makeAnswer()));
        await vi.waitFor(() => expect(acceptAnswerOnPeer).toHaveBeenCalledTimes(1));

        const secondPeer: AnswerPeer = {
            acceptAnswer: vi.fn<AnswerPeer['acceptAnswer']>().mockRejectedValue(new Error('newer SDP failure')),
        };
        peers.set('pending-2', secondPeer);
        mockRuntime.state.pendingInviteId = 'pending-2';
        await expect(
            acceptAnswer(JSON.stringify(makeAnswer({ pendingPeerId: 'pending-2', peerId: 'joiner-2' })))
        ).rejects.toThrow('newer SDP failure');

        firstSdp.resolve();
        await expect(first).resolves.toBeUndefined();
        expect(secondPeer.acceptAnswer).toHaveBeenCalledTimes(1);
        expect(collaborationStore.value?.error).toBe('newer SDP failure');
    });
});
