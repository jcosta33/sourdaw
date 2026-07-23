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
import { sessionRuntimePrimitives } from '../sessionManagement';

/**
 * `sessionRuntimePrimitives` orchestrates four real subsystems (WebRTC peer
 * connections, Automerge sync, asset transfer, permissions) plus the CRDT
 * document boundary. Mock all of them at the module boundary so these specs
 * exercise sessionManagement's own wiring and decision logic — message
 * routing, presence sanitization, peer bookkeeping, sync permission gating —
 * without opening a real peer connection or CRDT document.
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
    }[],
}));

const permissionManagerMock = vi.hoisted(() => ({
    instances: [] as {
        handleMessage: ReturnType<typeof vi.fn>;
        grantRole: ReturnType<typeof vi.fn>;
        canEdit: ReturnType<typeof vi.fn>;
        clear: ReturnType<typeof vi.fn>;
    }[],
}));

const crdtMock = vi.hoisted(() => ({
    cleanupProjectionBridge: vi.fn(),
}));

vi.mock('../../../repositories/peerConnection', () => ({
    PeerConnectionManager: vi.fn().mockImplementation(function (callbacks: CapturedCallbacks) {
        const instance = {
            callbacks,
            closeAll: vi.fn(),
            getConnectedPeerIds: vi.fn().mockReturnValue([]),
            broadcastPresence: vi.fn(),
            sendCrdtSync: vi.fn(),
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
    AssetTransfer: vi.fn().mockImplementation(function () {
        const instance = { handleMessage: vi.fn(), getAsset: vi.fn() };
        assetTransferMock.instances.push(instance);
        return instance;
    }),
}));

vi.mock('../../permissions', () => ({
    PermissionManager: vi.fn().mockImplementation(function () {
        const instance = {
            handleMessage: vi.fn(),
            grantRole: vi.fn(),
            canEdit: vi.fn().mockReturnValue(true),
            clear: vi.fn(),
        };
        permissionManagerMock.instances.push(instance);
        return instance;
    }),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    DOC_BRANCHES: '__branches__',
    setupProjectionBridge: vi.fn().mockReturnValue(crdtMock.cleanupProjectionBridge),
    removeCrdtDoc: vi.fn(),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
}));

function latestPeerManager() {
    return peerConnectionMock.instances.at(-1)!;
}
function latestAutomergeSync() {
    return automergeSyncMock.instances.at(-1)!;
}
function latestAssetTransfer() {
    return assetTransferMock.instances.at(-1)!;
}
function latestPermissionManager() {
    return permissionManagerMock.instances.at(-1)!;
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
        permissionManagerMock.instances.length = 0;
        collaborationStore.set(null);
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
            expect(permissionManagerMock.instances).toHaveLength(1);

            expect(sessionRuntimePrimitives.state.peerManager).toBe(peerManager);
            expect(sessionRuntimePrimitives.state.permissionManager).toBe(latestPermissionManager());
        });
    });

    describe('cleanup()', () => {
        it('tears down every subsystem and clears session state', () => {
            const peerManager = sessionRuntimePrimitives.initialize();
            const automergeSync = latestAutomergeSync();
            const permissionManager = latestPermissionManager();

            sessionRuntimePrimitives.cleanup();

            expect(automergeSync.stop).toHaveBeenCalledTimes(1);
            expect(crdtMock.cleanupProjectionBridge).toHaveBeenCalledTimes(1);
            expect(permissionManager.clear).toHaveBeenCalledTimes(1);
            expect(peerManager.closeAll).toHaveBeenCalledTimes(1);

            expect(sessionRuntimePrimitives.state.peerManager).toBeNull();
            expect(sessionRuntimePrimitives.state.automergeSync).toBeNull();
            expect(sessionRuntimePrimitives.state.assetTransfer).toBeNull();
            expect(sessionRuntimePrimitives.state.permissionManager).toBeNull();
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

        it('fails open when the permission manager is not yet constructed', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-2' })] }));
            sessionRuntimePrimitives.state.permissionManager = null;

            const { canApplySync } = latestAutomergeSync().hooks;
            expect(canApplySync?.('peer-2', 'root')).toBe(true);
        });

        it('delegates non-host, non-branch syncs to the permission manager', () => {
            sessionRuntimePrimitives.initialize();
            collaborationStore.set(makeState({ peers: [makePeer({ id: 'peer-2' })] }));
            latestPermissionManager().canEdit.mockReturnValue(false);

            const { canApplySync } = latestAutomergeSync().hooks;
            expect(canApplySync?.('peer-2', 'root')).toBe(false);
            expect(latestPermissionManager().canEdit).toHaveBeenCalledWith('peer-2');
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
            expect(latestPermissionManager().handleMessage).not.toHaveBeenCalled();
            expect(latestAutomergeSync().handlePeerMessage).not.toHaveBeenCalled();
        });

        it('routes a permissions crdt-sync message to the permission manager', () => {
            sessionRuntimePrimitives.initialize();
            const message: PeerMessage = { type: 'crdt-sync', docId: '__permissions__', data: 'payload' };

            latestPeerManager().callbacks.onMessage({ peerId: 'peer-1', message });

            expect(latestPermissionManager().handleMessage).toHaveBeenCalledWith('peer-1', message);
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
            sessionRuntimePrimitives.state.presenceListeners.add(listener);

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
            sessionRuntimePrimitives.state.presenceListeners.add(listener);

            const message: PeerMessage = {
                type: 'presence',
                data: { peerId: 'peer-1', name: 'Bob', color: '#3b82f6' },
            };

            latestPeerManager().callbacks.onMessage({ peerId: 'peer-1', message });

            expect(listener).not.toHaveBeenCalled();
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
        it('registers the peer with automerge sync, grants editor role, and marks it connected', () => {
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
            expect(latestPermissionManager().grantRole).toHaveBeenCalledWith('peer-1', 'editor');
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
    });
});
