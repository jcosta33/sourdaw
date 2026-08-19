import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    PEER_COLORS,
    type CollaborationState,
    type PeerId,
    type PeerInfo,
    type PeerMessage,
} from '../../../models/CollaborationTypes';
import { DOC_ID_ASSET } from '../../../models/SyncChannelConstants';
import { collaborationStore } from '../../../stores/collaborationStore';
import { onPresence } from '../onPresence';
import { sessionRuntimePrimitives } from '../sessionManagement';

/**
 * `sessionRuntimePrimitives` orchestrates three real subsystems (WebRTC peer
 * connections, Automerge sync, asset transfer) plus the CRDT document
 * boundary. Mock all of them at the module boundary so these specs exercise
 * sessionManagement's own wiring and decision logic — message routing,
 * presence sanitization, peer bookkeeping, and the host-authoritative branch
 * gate — without opening a real peer connection or CRDT document.
 *
 * There is no permission subsystem: an invite grants unconditional write
 * access (ADR 0016 ruling 4).
 */
type CapturedCallbacks = {
    onMessage: (input: { peerId: PeerId; message: PeerMessage }) => void;
    onConnected: (peerId: PeerId) => void;
    onDisconnected: (peerId: PeerId) => void;
};

const peerConnectionMock = vi.hoisted(() => ({
    instances: [] as {
        callbacks: CapturedCallbacks;
        closeAll: ReturnType<typeof vi.fn>;
        getConnectedPeerIds: ReturnType<typeof vi.fn>;
        broadcastPresence: ReturnType<typeof vi.fn>;
        sendCrdtSync: ReturnType<typeof vi.fn>;
        removePeer: ReturnType<typeof vi.fn>;
    }[],
}));

const automergeSyncMock = vi.hoisted(() => ({
    instances: [] as {
        hooks: {
            canApplySync?: (peerId: PeerId, docId: string) => boolean;
            onPersistError?: (error: unknown) => void;
        };
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        addPeer: ReturnType<typeof vi.fn>;
        removePeer: ReturnType<typeof vi.fn>;
        handlePeerMessage: ReturnType<typeof vi.fn>;
    }[],
}));

const assetTransferMock = vi.hoisted(() => ({
    instances: [] as {
        handleMessage: ReturnType<typeof vi.fn>;
        getAsset: ReturnType<typeof vi.fn>;
        options: {
            onAssetAvailable: (hash: string) => void;
            onProgress: (hash: string, received: number, total: number) => void;
        };
    }[],
}));

const crdtMock = vi.hoisted(() => {
    const unsubscribeAutomergeChanges = vi.fn();
    return {
        cleanupProjectionBridge: vi.fn(),
        removeCrdtDoc: vi.fn(),
        createCrdtDoc: vi.fn(),
        hasCrdtDoc: vi.fn().mockReturnValue(false),
        getCrdtDoc: vi.fn(),
        mutateCrdtDoc: vi.fn(),
        persistCrdtProject: vi.fn().mockResolvedValue(undefined),
        waitForCrdtDocumentTransition: vi.fn<(docId: string) => Promise<'aborted' | 'committed'> | null>(),
        subscribeToCrdtChanges: vi.fn().mockReturnValue(unsubscribeAutomergeChanges),
        unsubscribeAutomergeChanges,
        preserveBranchStateForSession: vi.fn(),
        replaceBranchState: vi.fn(),
        restoreBranchStateAfterSession: vi.fn(),
    };
});

const branchStoreMock = vi.hoisted(() => {
    const unsubscribeBranchStore = vi.fn();
    return {
        value: null as { branches: unknown[]; activeBranchId: string } | null,
        subscribe: vi.fn().mockReturnValue(unsubscribeBranchStore),
        unsubscribeBranchStore,
    };
});

const trackStoreMock = vi.hoisted(() => ({
    value: null as { tracks: { clips: { assetHash?: string; audioBufferId?: string; id: string }[] }[] } | null,
}));

const transportStoreMock = vi.hoisted(() => ({
    value: null as { playheadPosition: number } | null,
}));

const audioEngineMock = vi.hoisted(() => ({
    getAudioContext: vi.fn(),
    getCachedAudioBuffer: vi.fn(),
    cacheAudioBuffer: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../../repositories/peerConnection', () => ({
    PeerConnectionManager: vi.fn().mockImplementation(function (callbacks: CapturedCallbacks) {
        const instance = {
            callbacks,
            closeAll: vi.fn(),
            getConnectedPeerIds: vi.fn().mockReturnValue([]),
            broadcastPresence: vi.fn(),
            // Matches the real contract: the send resolves only once the
            // transport has taken the message.
            sendCrdtSync: vi.fn().mockResolvedValue(undefined),
            removePeer: vi.fn(),
        };
        peerConnectionMock.instances.push(instance);
        return instance;
    }),
}));

vi.mock('../../automergeSync', () => ({
    AutomergeSync: vi.fn().mockImplementation(function (
        _peerManager: unknown,
        hooks: {
            canApplySync?: (peerId: PeerId, docId: string) => boolean;
            onPersistError?: (error: unknown) => void;
        }
    ) {
        const instance = {
            hooks,
            start: vi.fn(),
            stop: vi.fn(),
            addPeer: vi.fn(),
            removePeer: vi.fn(),
            handlePeerMessage: vi.fn(),
        };
        automergeSyncMock.instances.push(instance);
        return instance;
    }),
}));

vi.mock('../../assetTransfer', () => ({
    AssetTransfer: vi.fn().mockImplementation(function (
        _peerManager: unknown,
        options: {
            onAssetAvailable: (hash: string) => void;
            onProgress: (hash: string, received: number, total: number) => void;
        }
    ) {
        const instance = { handleMessage: vi.fn(), getAsset: vi.fn(), options };
        assetTransferMock.instances.push(instance);
        return instance;
    }),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    DOC_BRANCHES: '__branches__',
    setupProjectionBridge: vi.fn().mockReturnValue(crdtMock.cleanupProjectionBridge),
    removeCrdtDoc: crdtMock.removeCrdtDoc,
    createCrdtDoc: crdtMock.createCrdtDoc,
    hasCrdtDoc: crdtMock.hasCrdtDoc,
    getCrdtDoc: crdtMock.getCrdtDoc,
    mutateCrdtDoc: crdtMock.mutateCrdtDoc,
    persistCrdtProject: crdtMock.persistCrdtProject,
    waitForCrdtDocumentTransition: crdtMock.waitForCrdtDocumentTransition,
    subscribeToCrdtChanges: crdtMock.subscribeToCrdtChanges,
    preserveBranchStateForSession: crdtMock.preserveBranchStateForSession,
    replaceBranchState: crdtMock.replaceBranchState,
    restoreBranchStateAfterSession: crdtMock.restoreBranchStateAfterSession,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    branchStore: branchStoreMock,
    MAIN_BRANCH_ID: 'main-branch-mock',
}));

vi.mock('#/modules/Arrangement/stores', () => ({ trackStore: trackStoreMock }));

vi.mock('#/modules/Transport/stores', () => ({ transportStore: transportStoreMock }));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: audioEngineMock.getAudioContext,
    getCachedAudioBuffer: audioEngineMock.getCachedAudioBuffer,
    cacheAudioBuffer: audioEngineMock.cacheAudioBuffer,
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: loggerMock.warn } }));

function latestPeerManager() {
    return peerConnectionMock.instances.at(-1)!;
}
function latestAutomergeSync() {
    return automergeSyncMock.instances.at(-1)!;
}
function latestAssetTransfer() {
    return assetTransferMock.instances.at(-1)!;
}
function makePeer(overrides: Partial<PeerInfo> = {}): PeerInfo {
    return {
        id: 'peer-x',
        name: 'Peer',
        color: '#3b82f6',
        isHost: false,
        isConnected: true,
        lastSeen: Date.now(),
        latencyMs: null,
        ...overrides,
    };
}

function makeState(overrides: Partial<CollaborationState> = {}): CollaborationState {
    return {
        isEnabled: true,
        sessionId: 'sess-1',
        localPeerId: 'local-1',
        localName: 'Me',
        localColor: '#3b82f6',
        isHost: false,
        peers: [],
        connectionStatus: 'disconnected',
        error: null,
        ...overrides,
    };
}

describe('sessionRuntimePrimitives', () => {
    describe('generatePeerId', () => {
        it('returns a well-formed UUID', () => {
            const id = sessionRuntimePrimitives.generatePeerId();
            expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        });

        it('returns a distinct value on each call', () => {
            const first = sessionRuntimePrimitives.generatePeerId();
            const second = sessionRuntimePrimitives.generatePeerId();
            expect(first).not.toBe(second);
        });
    });

    describe('generateSessionId', () => {
        it('returns the first 8 hex characters of a UUID', () => {
            const id = sessionRuntimePrimitives.generateSessionId();
            expect(id).toHaveLength(8);
            expect(id).toMatch(/^[0-9a-f]{8}$/i);
        });
    });

    describe('pickPeerColor', () => {
        it('picks the first palette color when nothing is excluded', () => {
            expect(sessionRuntimePrimitives.pickPeerColor([])).toBe(PEER_COLORS[0]);
        });

        it('skips colors already in use', () => {
            const excluded = [PEER_COLORS[0], PEER_COLORS[1]];
            expect(sessionRuntimePrimitives.pickPeerColor(excluded)).toBe(PEER_COLORS[2]);
        });

        it('falls back to an HSL overflow slot once the palette is exhausted', () => {
            const color = sessionRuntimePrimitives.pickPeerColor([...PEER_COLORS]);
            expect(color).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
        });

        it('advances past overflow slots that are already taken too', () => {
            const first = sessionRuntimePrimitives.pickPeerColor([...PEER_COLORS]);
            const second = sessionRuntimePrimitives.pickPeerColor([...PEER_COLORS, first]);
            expect(second).not.toBe(first);
            expect(second).toMatch(/^hsl\(\d+, 70%, 55%\)$/);
        });
    });

    describe('compressInvite / decompressInvite', () => {
        it('round-trips JSON through deflate-raw compression with a "z:" tag', async () => {
            const payload = JSON.stringify({ type: 'offer', peerId: 'p1', sessionId: 's1' });

            const compressed = await sessionRuntimePrimitives.compressInvite(payload);
            expect(compressed.startsWith('z:')).toBe(true);

            const decompressed = await sessionRuntimePrimitives.decompressInvite(compressed);
            expect(decompressed).toBe(payload);
        });

        it('falls back to legacy plain-base64 decoding for uncompressed invites', async () => {
            const payload = JSON.stringify({ type: 'offer', peerId: 'legacy' });
            const legacyInvite = btoa(payload);

            const decompressed = await sessionRuntimePrimitives.decompressInvite(legacyInvite);

            expect(decompressed).toBe(payload);
        });

        it('decodes a non-ASCII legacy invite exactly as the historical encoder wrote it', async () => {
            // The invite this branch exists for was minted by
            // `btoa(JSON.stringify(invite))`, and `btoa` writes one byte per
            // code unit — Latin-1, not UTF-8. `atob` is its exact inverse;
            // UTF-8-decoding those bytes would yield "Jos�".
            const payload = JSON.stringify({ type: 'offer', peerId: 'legacy', name: 'José' });
            const legacyInvite = btoa(payload);

            const decompressed = await sessionRuntimePrimitives.decompressInvite(legacyInvite);

            expect(decompressed).toBe(payload);
            expect((JSON.parse(decompressed) as { name: string }).name).toBe('José');
        });
    });

    describe('state', () => {
        it('starts with no active peer manager or pending invite', () => {
            expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
            expect(sessionRuntimePrimitives.state.pendingInviteId).toBeNull();
            expect(sessionRuntimePrimitives.state.hasBranchStateBackup).toBe(false);
        });
    });
});

describe('sessionRuntimePrimitives runtime wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        peerConnectionMock.instances.length = 0;
        automergeSyncMock.instances.length = 0;
        assetTransferMock.instances.length = 0;
        sessionRuntimePrimitives.presenceListeners.clear();
        collaborationStore.set(null);
        branchStoreMock.value = null;
        trackStoreMock.value = null;
        transportStoreMock.value = null;
        crdtMock.hasCrdtDoc.mockReturnValue(false);
        crdtMock.waitForCrdtDocumentTransition.mockReturnValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        sessionRuntimePrimitives.cleanup();
    });

    describe('initialize()', () => {
        it('constructs and wires every subsystem, and returns the peer manager', () => {
            const peerManager = sessionRuntimePrimitives.initialize();

            expect(peerConnectionMock.instances).toHaveLength(1);
            expect(peerManager).toBe(latestPeerManager());
            expect(latestAutomergeSync().start).toHaveBeenCalledTimes(1);
            expect(assetTransferMock.instances).toHaveLength(1);

            expect(sessionRuntimePrimitives.state.peerManager).toBe(peerManager);
        });
    });

    describe('cleanup()', () => {
        it('tears down every subsystem and clears session state', () => {
            const peerManager = sessionRuntimePrimitives.initialize();
            const automergeSync = latestAutomergeSync();

            sessionRuntimePrimitives.cleanup();

            expect(automergeSync.stop).toHaveBeenCalledTimes(1);
            expect(crdtMock.cleanupProjectionBridge).toHaveBeenCalledTimes(1);
            expect(peerManager.closeAll).toHaveBeenCalledTimes(1);

            expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
            expect(sessionRuntimePrimitives.state.automergeSync).toBeNull();
            expect(sessionRuntimePrimitives.state.assetTransfer).toBeNull();
        });

        it('is safe to call when no session is active', () => {
            expect(() => sessionRuntimePrimitives.cleanup()).not.toThrow();
        });
    });

    describe('canApplySync (AutomergeSync hooks built at initialize())', () => {
        it('always allows syncs sent by the host, even for branch metadata', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'host-1', isHost: true })] }));

            const { canApplySync } = latestAutomergeSync().hooks;
            expect(canApplySync?.('host-1', '__branches__')).toBe(true);
        });

        it('rejects branch-metadata syncs from a non-host sender', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-2' })] }));

            const { canApplySync } = latestAutomergeSync().hooks;
            expect(canApplySync?.('peer-2', '__branches__')).toBe(false);
        });

        it('applies a non-host peer sync to the root doc — an invite is unconditional write access', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-2' })] }));

            const { canApplySync } = latestAutomergeSync().hooks;
            expect(canApplySync?.('peer-2', 'root')).toBe(true);
        });

        it('applies a non-host peer sync to a branch content doc (only __branches__ is host-only)', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-2' })] }));

            const { canApplySync } = latestAutomergeSync().hooks;
            expect(canApplySync?.('peer-2', 'branch_abc')).toBe(true);
        });

        it('applies a sync from a peer the store has never seen (no join-time gate)', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [] }));

            const { canApplySync } = latestAutomergeSync().hooks;
            expect(canApplySync?.('unknown-peer', 'root')).toBe(true);
        });

        it('surfaces a store error when a received sync fails to persist', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState());

            latestAutomergeSync().hooks.onPersistError?.(new Error('boom'));

            expect(collaborationStore.value?.error).toBe('Failed to save received changes locally.');
        });
    });

    describe('handlePeerMessage (routed through the captured onMessage callback)', () => {
        it('routes an asset crdt-sync message to the asset transfer subsystem', () => {
            sessionRuntimePrimitives.initialize();
            const message: PeerMessage = { type: 'crdt-sync', docId: DOC_ID_ASSET, data: 'payload' };

            latestPeerManager().callbacks.onMessage({ peerId: 'peer-1', message });

            expect(latestAssetTransfer().handleMessage).toHaveBeenCalledWith('peer-1', message);
            expect(latestAutomergeSync().handlePeerMessage).not.toHaveBeenCalled();
        });

        it('no longer special-cases __permissions__ — it falls through to automerge sync, which drops it as an unknown doc', () => {
            sessionRuntimePrimitives.initialize();
            const message: PeerMessage = { type: 'crdt-sync', docId: '__permissions__', data: 'payload' };

            latestPeerManager().callbacks.onMessage({ peerId: 'peer-1', message });

            expect(latestAutomergeSync().handlePeerMessage).toHaveBeenCalledWith({ peerId: 'peer-1', message });
        });

        it('routes every other crdt-sync message to automerge sync', () => {
            sessionRuntimePrimitives.initialize();
            const message: PeerMessage = { type: 'crdt-sync', docId: 'root', data: 'payload' };

            latestPeerManager().callbacks.onMessage({ peerId: 'peer-1', message });

            expect(latestAutomergeSync().handlePeerMessage).toHaveBeenCalledWith({ peerId: 'peer-1', message });
        });

        it('sanitizes and forwards presence from a peer already known to the store', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-1', lastSeen: 0 })] }));
            const listener = vi.fn();
            sessionRuntimePrimitives.presenceListeners.add(listener);

            const longName = 'x'.repeat(100);
            const message: PeerMessage = {
                type: 'presence',
                data: { peerId: 'peer-1', name: longName, color: 'javascript:alert(1)' },
            };

            latestPeerManager().callbacks.onMessage({ peerId: 'peer-1', message });

            expect(listener).toHaveBeenCalledTimes(1);
            const [sanitized] = listener.mock.calls[0] as [{ name: string; color: string }];
            expect(sanitized.name).toHaveLength(64);
            expect(sanitized.color).toBe('#888888');
            expect(collaborationStore.value?.peers[0]?.lastSeen).toBeGreaterThan(0);
        });

        it('ignores presence from a peer the store does not know', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [] }));
            const listener = vi.fn();
            sessionRuntimePrimitives.presenceListeners.add(listener);

            const message: PeerMessage = {
                type: 'presence',
                data: { peerId: 'peer-1', name: 'Bob', color: '#3b82f6' },
            };

            latestPeerManager().callbacks.onMessage({ peerId: 'peer-1', message });

            expect(listener).not.toHaveBeenCalled();
        });

        it('keeps a mounted presence subscriber alive across a leave→rejoin cycle (regression: cleanup cleared app-lifetime listeners)', () => {
            const listener = vi.fn();
            const unsubscribe = onPresence(listener);

            // Session 1 ends: leave/create/join all run cleanup().
            sessionRuntimePrimitives.initialize();
            sessionRuntimePrimitives.cleanup();

            // Session 2: the overlay hook never re-subscribes — the same
            // registration must still receive presence.
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-1' })] }));
            latestPeerManager().callbacks.onMessage({
                peerId: 'peer-1',
                message: { type: 'presence', data: { peerId: 'peer-1', name: 'Bob', color: '#3b82f6' } },
            });

            expect(listener).toHaveBeenCalledTimes(1);

            // The subscriber still owns its registration: disposing works.
            unsubscribe();
            latestPeerManager().callbacks.onMessage({
                peerId: 'peer-1',
                message: { type: 'presence', data: { peerId: 'peer-1', name: 'Bob', color: '#3b82f6' } },
            });
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('adds a newly seen peer from a peer-info message without trusting its self-claimed host flag', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ localPeerId: 'local-1', peers: [] }));

            latestPeerManager().callbacks.onMessage({
                peerId: 'peer-2',
                message: { type: 'peer-info', peer: makePeer({ id: 'peer-2', isHost: true }) },
            });

            expect(collaborationStore.value?.peers).toHaveLength(1);
            expect(collaborationStore.value?.peers[0]?.isHost).toBe(false);
        });

        it('bounds sender-controlled identity fields from a peer-info message with the presence limits', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ localPeerId: 'local-1', peers: [] }));

            latestPeerManager().callbacks.onMessage({
                peerId: 'peer-2',
                message: {
                    type: 'peer-info',
                    peer: makePeer({ id: 'peer-2', name: 'x'.repeat(100), color: 'javascript:alert(1)' }),
                },
            });

            expect(collaborationStore.value?.peers[0]?.name).toHaveLength(64);
            expect(collaborationStore.value?.peers[0]?.color).toBe('#888888');
        });

        it('rejects a peer-info carrying an over-length peer id instead of storing it', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ localPeerId: 'local-1', peers: [] }));

            latestPeerManager().callbacks.onMessage({
                peerId: 'peer-2',
                message: { type: 'peer-info', peer: makePeer({ id: 'x'.repeat(5000) }) },
            });

            expect(collaborationStore.value?.peers).toHaveLength(0);
        });

        it('adopts a host-assigned color from a peer-info message describing ourselves', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(
                makeState({
                    localPeerId: 'local-1',
                    localColor: '#3b82f6',
                    isHost: false,
                    peers: [makePeer({ id: 'host-1', isHost: true })],
                })
            );

            latestPeerManager().callbacks.onMessage({
                peerId: 'host-1',
                message: { type: 'peer-info', peer: makePeer({ id: 'local-1', color: '#ef4444' }) },
            });

            expect(collaborationStore.value?.localColor).toBe('#ef4444');
            expect(collaborationStore.value?.peers).toHaveLength(1);
        });

        it('sanitizes a host-assigned color before adopting it as localColor', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(
                makeState({
                    localPeerId: 'local-1',
                    localColor: '#3b82f6',
                    isHost: false,
                    peers: [makePeer({ id: 'host-1', isHost: true })],
                })
            );

            latestPeerManager().callbacks.onMessage({
                peerId: 'host-1',
                message: { type: 'peer-info', peer: makePeer({ id: 'local-1', color: 'url(javascript:alert(1))' }) },
            });

            expect(collaborationStore.value?.localColor).toBe('#888888');
        });

        it('removes a peer on a self-issued peer-leave message', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-2' })] }));

            latestPeerManager().callbacks.onMessage({
                peerId: 'peer-2',
                message: { type: 'peer-leave', peerId: 'peer-2' },
            });

            expect(collaborationStore.value?.peers).toHaveLength(0);
            expect(latestPeerManager().removePeer).toHaveBeenCalledWith('peer-2');
        });

        it('ignores a peer-leave message impersonating a different peer', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-2' })] }));

            latestPeerManager().callbacks.onMessage({
                peerId: 'peer-3',
                message: { type: 'peer-leave', peerId: 'peer-2' },
            });

            expect(collaborationStore.value?.peers).toHaveLength(1);
        });
    });

    describe('handlePeerConnected (routed through the captured onConnected callback)', () => {
        it('registers the peer with automerge sync and marks it connected (no role is granted)', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(
                makeState({
                    localPeerId: 'local-1',
                    localName: 'Me',
                    peers: [makePeer({ id: 'peer-1', isConnected: false })],
                })
            );

            latestPeerManager().callbacks.onConnected('peer-1');

            expect(latestAutomergeSync().addPeer).toHaveBeenCalledWith('peer-1');
            expect(collaborationStore.value?.peers[0]?.isConnected).toBe(true);
            expect(collaborationStore.value?.connectionStatus).toBe('connected');
            expect(latestPeerManager().sendCrdtSync).toHaveBeenCalledWith({
                peerId: 'peer-1',
                message: { type: 'peer-info', peer: expect.objectContaining({ id: 'local-1', name: 'Me' }) },
            });
        });

        it('re-announces the host-assigned color to a joiner once connected', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(
                makeState({
                    localPeerId: 'host-1',
                    isHost: true,
                    peers: [makePeer({ id: 'peer-1', color: '#ef4444' })],
                })
            );

            latestPeerManager().callbacks.onConnected('peer-1');

            expect(latestPeerManager().sendCrdtSync).toHaveBeenCalledTimes(2);
            const secondCall = latestPeerManager().sendCrdtSync.mock.calls[1] as [
                { peerId: string; message: { type: string } },
            ];
            expect(secondCall[0]).toMatchObject({ peerId: 'peer-1', message: { type: 'peer-info' } });
        });

        it('does not re-announce a color for a peer we have no record of yet', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ localPeerId: 'host-1', isHost: true, peers: [] }));

            latestPeerManager().callbacks.onConnected('peer-1');

            expect(latestPeerManager().sendCrdtSync).toHaveBeenCalledTimes(1);
        });

        it('cancels a pending disconnect cleanup when the peer reconnects in time', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-1' })] }));

            latestPeerManager().callbacks.onDisconnected('peer-1');
            latestPeerManager().callbacks.onConnected('peer-1');
            vi.advanceTimersByTime(20_000);

            expect(collaborationStore.value?.peers.some((peer) => peer.id === 'peer-1')).toBe(true);
        });
    });

    describe('handlePeerDisconnected (routed through the captured onDisconnected callback)', () => {
        it('marks the peer disconnected immediately and removes it after the grace period', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ connectionStatus: 'connected', peers: [makePeer({ id: 'peer-1' })] }));

            latestPeerManager().callbacks.onDisconnected('peer-1');

            expect(latestAutomergeSync().removePeer).toHaveBeenCalledWith('peer-1');
            expect(collaborationStore.value?.peers[0]?.isConnected).toBe(false);
            expect(collaborationStore.value?.connectionStatus).toBe('disconnected');

            vi.advanceTimersByTime(15_000);

            expect(collaborationStore.value?.peers).toHaveLength(0);
            expect(latestPeerManager().removePeer).toHaveBeenCalledWith('peer-1');
        });

        it('keeps connectionStatus connected while another peer is still connected', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(
                makeState({
                    connectionStatus: 'connected',
                    peers: [makePeer({ id: 'peer-1' }), makePeer({ id: 'peer-2' })],
                })
            );

            latestPeerManager().callbacks.onDisconnected('peer-1');

            expect(collaborationStore.value?.connectionStatus).toBe('connected');
        });

        /** A joiner whose only peer is the host, mid-session with a live broadcast. */
        function startJoinerWithHost(): void {
            sessionRuntimePrimitives.initialize();
            latestPeerManager().getConnectedPeerIds.mockReturnValue(['host-1']);
            collaborationStore.set(
                makeState({
                    isHost: false,
                    localPeerId: 'local-1',
                    connectionStatus: 'connected',
                    peers: [makePeer({ id: 'host-1', isHost: true })],
                })
            );
            sessionRuntimePrimitives.startPlayheadBroadcast();
            vi.advanceTimersByTime(250);
        }

        it('surfaces session end and stops the playhead broadcast once the HOST cleanup timer elapses', () => {
            vi.useFakeTimers();
            startJoinerWithHost();
            expect(latestPeerManager().broadcastPresence.mock.calls.length).toBeGreaterThan(0);

            latestPeerManager().callbacks.onDisconnected('host-1');

            // Nothing is declared over yet: `disconnected` is a transient ICE
            // state, and the grace timer is what decides the host is really gone.
            expect(collaborationStore.value?.error).toBeNull();

            vi.advanceTimersByTime(15_000);

            expect(collaborationStore.value?.connectionStatus).toBe('disconnected');
            expect(collaborationStore.value?.error).toMatch(/host disconnected/i);
            expect(collaborationStore.value?.error).toMatch(/session has ended/i);
            // No silent auto-leave: the session state (and the local project
            // copy) stays until the user explicitly leaves.
            expect(collaborationStore.value?.isEnabled).toBe(true);

            // The playhead broadcast interval is stopped, not left ticking
            // into a dead session.
            const callsAtDeparture = latestPeerManager().broadcastPresence.mock.calls.length;
            vi.advanceTimersByTime(1000);
            expect(latestPeerManager().broadcastPresence).toHaveBeenCalledTimes(callsAtDeparture);
        });

        it('treats a host disconnect that recovers inside the grace period as a blip, not a session end', () => {
            vi.useFakeTimers();
            startJoinerWithHost();

            latestPeerManager().callbacks.onDisconnected('host-1');
            vi.advanceTimersByTime(1000);
            latestPeerManager().callbacks.onConnected('host-1');
            vi.advanceTimersByTime(20_000);

            expect(collaborationStore.value?.connectionStatus).toBe('connected');
            expect(collaborationStore.value?.error).toBeNull();
            expect(collaborationStore.value?.peers.some((peer) => peer.id === 'host-1')).toBe(true);

            // The broadcast never stopped, so this joiner's playhead is still
            // reaching the other peers.
            const callsAfterRecovery = latestPeerManager().broadcastPresence.mock.calls.length;
            vi.advanceTimersByTime(250);
            expect(latestPeerManager().broadcastPresence.mock.calls.length).toBeGreaterThan(callsAfterRecovery);
        });

        it('clears the session-ended error and restarts the broadcast when the host comes back after departing', () => {
            vi.useFakeTimers();
            startJoinerWithHost();

            latestPeerManager().callbacks.onDisconnected('host-1');
            vi.advanceTimersByTime(15_000);
            expect(collaborationStore.value?.error).toMatch(/session has ended/i);
            const callsWhileEnded = latestPeerManager().broadcastPresence.mock.calls.length;

            latestPeerManager().callbacks.onConnected('host-1');

            expect(collaborationStore.value?.connectionStatus).toBe('connected');
            expect(collaborationStore.value?.error).toBeNull();

            vi.advanceTimersByTime(250);
            expect(latestPeerManager().broadcastPresence.mock.calls.length).toBeGreaterThan(callsWhileEnded);
        });

        it('does not declare the session ended when a non-host peer disconnects', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(
                makeState({
                    isHost: false,
                    connectionStatus: 'connected',
                    peers: [makePeer({ id: 'host-1', isHost: true }), makePeer({ id: 'peer-2' })],
                })
            );

            latestPeerManager().callbacks.onDisconnected('peer-2');

            expect(collaborationStore.value?.connectionStatus).toBe('connected');
            expect(collaborationStore.value?.error).toBeNull();
        });
    });

    describe('startBranchSync / stopBranchSync (via startBranchSync() and cleanup())', () => {
        it('seeds the __branches__ doc from the current branch list when hosting', () => {
            branchStoreMock.value = { branches: [{ id: 'b1' }], activeBranchId: 'b1' };

            sessionRuntimePrimitives.startBranchSync(true);

            expect(crdtMock.removeCrdtDoc).toHaveBeenCalledWith('__branches__');
            expect(crdtMock.createCrdtDoc).toHaveBeenCalledWith('__branches__');
            expect(crdtMock.preserveBranchStateForSession).toHaveBeenCalledTimes(1);
            expect(sessionRuntimePrimitives.state.hasBranchStateBackup).toBe(true);

            const seedCall = crdtMock.mutateCrdtDoc.mock.calls.find(
                (call) => (call[0] as { id: string }).id === '__branches__'
            ) as [{ id: string; changeFn: (doc: Record<string, unknown>) => void }];
            const doc: Record<string, unknown> = {};
            seedCall[0].changeFn(doc);
            expect(doc.branches).toEqual([{ id: 'b1' }]);
        });

        it('does not seed the doc when joining as a non-host', () => {
            sessionRuntimePrimitives.startBranchSync(false);

            expect(crdtMock.removeCrdtDoc).not.toHaveBeenCalled();
            expect(crdtMock.createCrdtDoc).not.toHaveBeenCalled();
        });

        it('mirrors local branch mutations into the doc when a doc already exists', () => {
            crdtMock.hasCrdtDoc.mockReturnValue(true);
            sessionRuntimePrimitives.startBranchSync(true);
            const branchStoreListener = branchStoreMock.subscribe.mock.calls.at(-1)![0] as (
                state: { branches: unknown[]; activeBranchId: string } | null
            ) => void;
            crdtMock.mutateCrdtDoc.mockClear();

            branchStoreListener({ branches: [{ id: 'mirrored' }], activeBranchId: 'b1' });

            expect(crdtMock.mutateCrdtDoc).toHaveBeenCalledTimes(1);
            const [{ id, changeFn }] = crdtMock.mutateCrdtDoc.mock.calls[0] as [
                { id: string; changeFn: (doc: Record<string, unknown>) => void },
            ];
            expect(id).toBe('__branches__');
            const doc: Record<string, unknown> = {};
            changeFn(doc);
            expect(doc.branches).toEqual([{ id: 'mirrored' }]);
        });

        it('defers local branch metadata until its document transition commits', async () => {
            let finishTransition: ((outcome: 'aborted' | 'committed') => void) | undefined;
            const transition = new Promise<'aborted' | 'committed'>((resolve) => {
                finishTransition = resolve;
            });
            crdtMock.hasCrdtDoc.mockReturnValue(true);
            crdtMock.waitForCrdtDocumentTransition.mockReturnValue(transition);
            sessionRuntimePrimitives.startBranchSync(true);
            const branchStoreListener = branchStoreMock.subscribe.mock.calls.at(-1)![0] as (
                state: { branches: unknown[]; activeBranchId: string } | null
            ) => void;
            crdtMock.mutateCrdtDoc.mockClear();

            branchStoreListener({ branches: [{ id: 'committed' }], activeBranchId: 'b1' });

            expect(crdtMock.mutateCrdtDoc).not.toHaveBeenCalled();
            finishTransition?.('committed');
            await transition;
            await Promise.resolve();

            expect(crdtMock.mutateCrdtDoc).toHaveBeenCalledTimes(1);
            const [{ id, changeFn }] = crdtMock.mutateCrdtDoc.mock.calls[0] as [
                { id: string; changeFn: (doc: Record<string, unknown>) => void },
            ];
            expect(id).toBe('__branches__');
            const doc: Record<string, unknown> = {};
            changeFn(doc);
            expect(doc.branches).toEqual([{ id: 'committed' }]);
        });

        it('drops provisional branch metadata when its document transition aborts', async () => {
            let finishTransition: ((outcome: 'aborted' | 'committed') => void) | undefined;
            const transition = new Promise<'aborted' | 'committed'>((resolve) => {
                finishTransition = resolve;
            });
            crdtMock.hasCrdtDoc.mockReturnValue(true);
            crdtMock.waitForCrdtDocumentTransition.mockReturnValue(transition);
            sessionRuntimePrimitives.startBranchSync(true);
            const branchStoreListener = branchStoreMock.subscribe.mock.calls.at(-1)![0] as (
                state: { branches: unknown[]; activeBranchId: string } | null
            ) => void;
            crdtMock.mutateCrdtDoc.mockClear();

            branchStoreListener({ branches: [{ id: 'provisional' }], activeBranchId: 'b1' });

            finishTransition?.('aborted');
            await transition;
            await Promise.resolve();

            expect(crdtMock.mutateCrdtDoc).not.toHaveBeenCalled();
        });

        it('does not mirror branch mutations while a projection is already in flight', () => {
            crdtMock.hasCrdtDoc.mockReturnValue(true);
            sessionRuntimePrimitives.startBranchSync(true);
            const branchStoreListener = branchStoreMock.subscribe.mock.calls.at(-1)![0] as (
                state: { branches: unknown[]; activeBranchId: string } | null
            ) => void;
            crdtMock.mutateCrdtDoc.mockClear();
            sessionRuntimePrimitives.state.isProjectingBranches = true;

            branchStoreListener({ branches: [{ id: 'ignored' }], activeBranchId: 'b1' });

            expect(crdtMock.mutateCrdtDoc).not.toHaveBeenCalled();
            sessionRuntimePrimitives.state.isProjectingBranches = false;
        });

        it('does not mirror branch mutations when the doc has not been created yet', () => {
            crdtMock.hasCrdtDoc.mockReturnValue(false);
            sessionRuntimePrimitives.startBranchSync(true);
            const branchStoreListener = branchStoreMock.subscribe.mock.calls.at(-1)![0] as (
                state: { branches: unknown[]; activeBranchId: string } | null
            ) => void;
            crdtMock.mutateCrdtDoc.mockClear();

            branchStoreListener({ branches: [{ id: 'ignored' }], activeBranchId: 'b1' });

            expect(crdtMock.mutateCrdtDoc).not.toHaveBeenCalled();
        });

        it('does not mirror a null branchStore state', () => {
            crdtMock.hasCrdtDoc.mockReturnValue(true);
            sessionRuntimePrimitives.startBranchSync(true);
            const branchStoreListener = branchStoreMock.subscribe.mock.calls.at(-1)![0] as (
                state: { branches: unknown[]; activeBranchId: string } | null
            ) => void;
            crdtMock.mutateCrdtDoc.mockClear();

            branchStoreListener(null);

            expect(crdtMock.mutateCrdtDoc).not.toHaveBeenCalled();
        });

        it('projects an incoming __branches__ doc change into branchStore via replaceBranchState', () => {
            sessionRuntimePrimitives.startBranchSync(true);
            const crdtChangeListener = crdtMock.subscribeToCrdtChanges.mock.calls.at(-1)![0] as (
                docId?: string
            ) => void;
            crdtMock.getCrdtDoc.mockReturnValue({ branches: [{ id: 'incoming' }] });
            branchStoreMock.value = { branches: [], activeBranchId: 'active-1' };

            crdtChangeListener('__branches__');

            expect(crdtMock.replaceBranchState).toHaveBeenCalledWith({
                branches: [{ id: 'incoming' }],
                activeBranchId: 'active-1',
            });
            expect(sessionRuntimePrimitives.state.lastProjectedBranchesJson).toBe(JSON.stringify([{ id: 'incoming' }]));
        });

        it('falls back to MAIN_BRANCH_ID when branchStore has no active branch yet', () => {
            sessionRuntimePrimitives.startBranchSync(true);
            const crdtChangeListener = crdtMock.subscribeToCrdtChanges.mock.calls.at(-1)![0] as (
                docId?: string
            ) => void;
            crdtMock.getCrdtDoc.mockReturnValue({ branches: [{ id: 'incoming' }] });
            branchStoreMock.value = null;

            crdtChangeListener(undefined);

            expect(crdtMock.replaceBranchState).toHaveBeenCalledWith({
                branches: [{ id: 'incoming' }],
                activeBranchId: 'main-branch-mock',
            });
        });

        it('ignores a change notification for an unrelated doc id', () => {
            sessionRuntimePrimitives.startBranchSync(true);
            const crdtChangeListener = crdtMock.subscribeToCrdtChanges.mock.calls.at(-1)![0] as (
                docId?: string
            ) => void;
            crdtMock.getCrdtDoc.mockClear();

            crdtChangeListener('some-other-doc');

            expect(crdtMock.getCrdtDoc).not.toHaveBeenCalled();
            expect(crdtMock.replaceBranchState).not.toHaveBeenCalled();
        });

        it('ignores a change notification whose doc has no branches array yet', () => {
            sessionRuntimePrimitives.startBranchSync(true);
            const crdtChangeListener = crdtMock.subscribeToCrdtChanges.mock.calls.at(-1)![0] as (
                docId?: string
            ) => void;
            crdtMock.getCrdtDoc.mockReturnValue({ branches: 'not-an-array' });

            crdtChangeListener('__branches__');

            expect(crdtMock.replaceBranchState).not.toHaveBeenCalled();
        });

        it('skips re-projecting the same branch JSON twice in a row', () => {
            sessionRuntimePrimitives.startBranchSync(true);
            const crdtChangeListener = crdtMock.subscribeToCrdtChanges.mock.calls.at(-1)![0] as (
                docId?: string
            ) => void;
            crdtMock.getCrdtDoc.mockReturnValue({ branches: [{ id: 'same' }] });

            crdtChangeListener('__branches__');
            crdtMock.replaceBranchState.mockClear();
            crdtChangeListener('__branches__');

            expect(crdtMock.replaceBranchState).not.toHaveBeenCalled();
        });

        it('stops branch sync on cleanup: unsubscribes, removes the doc, restores state, and persists', async () => {
            branchStoreMock.value = { branches: [], activeBranchId: 'b1' };
            sessionRuntimePrimitives.startBranchSync(true);
            crdtMock.removeCrdtDoc.mockClear();

            sessionRuntimePrimitives.cleanup();

            expect(branchStoreMock.unsubscribeBranchStore).toHaveBeenCalledTimes(1);
            expect(crdtMock.unsubscribeAutomergeChanges).toHaveBeenCalledTimes(1);
            expect(crdtMock.removeCrdtDoc).toHaveBeenCalledWith('__branches__');
            expect(crdtMock.restoreBranchStateAfterSession).toHaveBeenCalledTimes(1);
            expect(crdtMock.persistCrdtProject).toHaveBeenCalledTimes(1);
            expect(sessionRuntimePrimitives.state.hasBranchStateBackup).toBe(false);
            expect(sessionRuntimePrimitives.state.lastProjectedBranchesJson).toBeNull();
            await Promise.resolve();
        });

        it('does not restore branch state on cleanup when no backup was ever taken', () => {
            sessionRuntimePrimitives.cleanup();

            expect(crdtMock.restoreBranchStateAfterSession).not.toHaveBeenCalled();
        });

        it('surfaces a store error and logs a warning when post-cleanup persistence fails', async () => {
            collaborationStore.set(makeState());
            crdtMock.persistCrdtProject.mockRejectedValueOnce(new Error('disk full'));
            sessionRuntimePrimitives.startBranchSync(true);

            sessionRuntimePrimitives.cleanup();
            await Promise.resolve();
            await Promise.resolve();

            expect(loggerMock.warn).toHaveBeenCalledWith(
                '[Collaboration] Failed to persist after branch sync cleanup:',
                expect.any(Error)
            );
            expect(collaborationStore.value?.error).toBe('Failed to save project locally after leaving the session.');
        });
    });

    describe('resolveAssetForClips (invoked via the AssetTransfer onAssetAvailable hook)', () => {
        function makeAudioBuffer(): AudioBuffer {
            return { duration: 1 } as AudioBuffer;
        }

        it('does nothing when the transferred asset is not yet available', async () => {
            sessionRuntimePrimitives.initialize();
            latestAssetTransfer().getAsset.mockReturnValue(undefined);
            trackStoreMock.value = { tracks: [{ clips: [{ id: 'c1', assetHash: 'hash-1', audioBufferId: 'buf-1' }] }] };

            latestAssetTransfer().options.onAssetAvailable('hash-1');
            await Promise.resolve();
            await Promise.resolve();

            expect(audioEngineMock.cacheAudioBuffer).not.toHaveBeenCalled();
        });

        it('does nothing when the audio context is unavailable', async () => {
            sessionRuntimePrimitives.initialize();
            latestAssetTransfer().getAsset.mockReturnValue({ arrayBuffer: vi.fn() });
            audioEngineMock.getAudioContext.mockImplementation(() => {
                throw new Error('no context yet');
            });
            trackStoreMock.value = { tracks: [{ clips: [{ id: 'c1', assetHash: 'hash-1', audioBufferId: 'buf-1' }] }] };

            latestAssetTransfer().options.onAssetAvailable('hash-1');
            await Promise.resolve();
            await Promise.resolve();

            expect(audioEngineMock.cacheAudioBuffer).not.toHaveBeenCalled();
        });

        it('decodes and caches the buffer for a matching, uncached clip', async () => {
            sessionRuntimePrimitives.initialize();
            const arrayBuffer = new ArrayBuffer(8);
            const blob = { arrayBuffer: vi.fn().mockResolvedValue(arrayBuffer) };
            latestAssetTransfer().getAsset.mockReturnValue(blob);
            const decodedBuffer = makeAudioBuffer();
            const decodeAudioData = vi.fn().mockResolvedValue(decodedBuffer);
            audioEngineMock.getAudioContext.mockReturnValue({ decodeAudioData });
            audioEngineMock.getCachedAudioBuffer.mockReturnValue(null);
            trackStoreMock.value = { tracks: [{ clips: [{ id: 'c1', assetHash: 'hash-1', audioBufferId: 'buf-1' }] }] };

            latestAssetTransfer().options.onAssetAvailable('hash-1');
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            expect(decodeAudioData).toHaveBeenCalledWith(arrayBuffer);
            expect(audioEngineMock.cacheAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buf-1', buffer: decodedBuffer });
        });

        it('skips a clip whose asset hash does not match', async () => {
            sessionRuntimePrimitives.initialize();
            latestAssetTransfer().getAsset.mockReturnValue({ arrayBuffer: vi.fn() });
            audioEngineMock.getAudioContext.mockReturnValue({ decodeAudioData: vi.fn() });
            trackStoreMock.value = {
                tracks: [{ clips: [{ id: 'c1', assetHash: 'other-hash', audioBufferId: 'buf-1' }] }],
            };

            latestAssetTransfer().options.onAssetAvailable('hash-1');
            await Promise.resolve();
            await Promise.resolve();

            expect(audioEngineMock.cacheAudioBuffer).not.toHaveBeenCalled();
        });

        it('skips a matching clip that has no audioBufferId', async () => {
            sessionRuntimePrimitives.initialize();
            latestAssetTransfer().getAsset.mockReturnValue({ arrayBuffer: vi.fn() });
            audioEngineMock.getAudioContext.mockReturnValue({ decodeAudioData: vi.fn() });
            trackStoreMock.value = { tracks: [{ clips: [{ id: 'c1', assetHash: 'hash-1' }] }] };

            latestAssetTransfer().options.onAssetAvailable('hash-1');
            await Promise.resolve();
            await Promise.resolve();

            expect(audioEngineMock.cacheAudioBuffer).not.toHaveBeenCalled();
        });

        it('skips decoding a clip whose buffer is already cached', async () => {
            sessionRuntimePrimitives.initialize();
            const blob = { arrayBuffer: vi.fn() };
            latestAssetTransfer().getAsset.mockReturnValue(blob);
            const decodeAudioData = vi.fn();
            audioEngineMock.getAudioContext.mockReturnValue({ decodeAudioData });
            audioEngineMock.getCachedAudioBuffer.mockReturnValue(makeAudioBuffer());
            trackStoreMock.value = { tracks: [{ clips: [{ id: 'c1', assetHash: 'hash-1', audioBufferId: 'buf-1' }] }] };

            latestAssetTransfer().options.onAssetAvailable('hash-1');
            await Promise.resolve();
            await Promise.resolve();

            expect(blob.arrayBuffer).not.toHaveBeenCalled();
            expect(decodeAudioData).not.toHaveBeenCalled();
        });

        it('logs a warning and continues when decoding fails for a clip', async () => {
            sessionRuntimePrimitives.initialize();
            const blob = { arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)) };
            latestAssetTransfer().getAsset.mockReturnValue(blob);
            const decodeAudioData = vi.fn().mockRejectedValue(new Error('bad codec'));
            audioEngineMock.getAudioContext.mockReturnValue({ decodeAudioData });
            audioEngineMock.getCachedAudioBuffer.mockReturnValue(null);
            trackStoreMock.value = { tracks: [{ clips: [{ id: 'c1', assetHash: 'hash-1', audioBufferId: 'buf-1' }] }] };

            latestAssetTransfer().options.onAssetAvailable('hash-1');
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();

            expect(loggerMock.warn).toHaveBeenCalledWith('[Collaboration] Failed to decode asset for clip', 'c1');
            expect(audioEngineMock.cacheAudioBuffer).not.toHaveBeenCalled();
        });
    });

    describe('startPlayheadBroadcast / stopPlayheadBroadcast', () => {
        it('does not broadcast while no peers are connected', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ localPeerId: 'local-1' }));
            latestPeerManager().getConnectedPeerIds.mockReturnValue([]);

            sessionRuntimePrimitives.startPlayheadBroadcast();
            vi.advanceTimersByTime(250);

            expect(latestPeerManager().broadcastPresence).not.toHaveBeenCalled();
        });

        it('does not broadcast when there is no active collaboration state', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            latestPeerManager().getConnectedPeerIds.mockReturnValue(['peer-1']);
            collaborationStore.set(null);

            sessionRuntimePrimitives.startPlayheadBroadcast();
            vi.advanceTimersByTime(250);

            expect(latestPeerManager().broadcastPresence).not.toHaveBeenCalled();
        });

        it('broadcasts the local playhead position at ~4 Hz once peers are connected', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            latestPeerManager().getConnectedPeerIds.mockReturnValue(['peer-1']);
            collaborationStore.set(makeState({ localPeerId: 'local-1', localName: 'Me', localColor: '#3b82f6' }));
            transportStoreMock.value = { playheadPosition: 42 };

            sessionRuntimePrimitives.startPlayheadBroadcast();
            vi.advanceTimersByTime(250);

            expect(latestPeerManager().broadcastPresence).toHaveBeenCalledTimes(1);
            expect(latestPeerManager().broadcastPresence).toHaveBeenCalledWith({
                type: 'presence',
                data: { peerId: 'local-1', name: 'Me', color: '#3b82f6', playheadBeat: 42 },
            });

            vi.advanceTimersByTime(250);
            expect(latestPeerManager().broadcastPresence).toHaveBeenCalledTimes(2);
        });

        it('defaults the playhead beat to null when the transport has no position yet', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            latestPeerManager().getConnectedPeerIds.mockReturnValue(['peer-1']);
            collaborationStore.set(makeState({ localPeerId: 'local-1' }));
            transportStoreMock.value = null;

            sessionRuntimePrimitives.startPlayheadBroadcast();
            vi.advanceTimersByTime(250);

            const [call] = latestPeerManager().broadcastPresence.mock.calls[0] as [{ data: { playheadBeat: unknown } }];
            expect(call.data.playheadBeat).toBeNull();
        });

        it('stops broadcasting once cleanup() clears the interval', () => {
            vi.useFakeTimers();
            sessionRuntimePrimitives.initialize();
            latestPeerManager().getConnectedPeerIds.mockReturnValue(['peer-1']);
            collaborationStore.set(makeState({ localPeerId: 'local-1' }));

            sessionRuntimePrimitives.startPlayheadBroadcast();
            vi.advanceTimersByTime(250);
            const callsBeforeCleanup = latestPeerManager().broadcastPresence.mock.calls.length;

            sessionRuntimePrimitives.cleanup();
            vi.advanceTimersByTime(1000);

            expect(latestPeerManager().broadcastPresence).toHaveBeenCalledTimes(callsBeforeCleanup);
        });
    });
});
