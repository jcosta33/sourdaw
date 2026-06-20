import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSession, leaveSession } from '../sessionManagement';

const mocks = vi.hoisted(() => {
    const automergeStart = vi.fn();
    const collaborationStoreValue = { value: {} as Record<string, unknown> };
    // Write-through set so multi-step handler flows (which read-then-write the
    // store) compose; records every call for assertions.
    const collaborationStoreSet = vi.fn((next: Record<string, unknown>) => {
        collaborationStoreValue.value = next;
    });
    // Capture the callbacks passed to the PeerConnectionManager constructor so
    // tests can drive incoming peer messages through the real handlePeerMessage.
    const peerCallbacks: { onMessage?: (input: { peerId: string; message: unknown }) => void } = {};
    return {
        collaborationStoreValue,
        collaborationStoreSet,
        peerCallbacks,
        automergeStart,
        PeerConnectionManager: vi.fn(function PeerConnectionManagerMock(
            this: Record<string, unknown>,
            callbacks: { onMessage?: (input: { peerId: string; message: unknown }) => void }
        ) {
            peerCallbacks.onMessage = callbacks.onMessage;
            Object.assign(this, {
                closeAll: vi.fn(),
                getConnectedPeerIds: vi.fn(() => []),
                broadcastCrdtSync: vi.fn(),
                broadcastPresence: vi.fn(),
                sendCrdtSync: vi.fn(),
                sendCrdtSyncBuffered: vi.fn(() => Promise.resolve()),
                removePeer: vi.fn(),
            });
        }),
        AutomergeSync: vi.fn(function AutomergeSyncMock() {
            return {
                start: automergeStart,
                stop: vi.fn(),
                addPeer: vi.fn(),
                removePeer: vi.fn(),
                handlePeerMessage: vi.fn(),
            };
        }),
        AssetTransfer: vi.fn(function AssetTransferMock(this: Record<string, unknown>) {
            Object.assign(this, {
                getAsset: vi.fn(),
                handleMessage: vi.fn(),
            });
        }),
        PermissionManager: vi.fn(function PermissionManagerMock(this: Record<string, unknown>) {
            Object.assign(this, {
                clear: vi.fn(),
                grantRole: vi.fn(),
                handleMessage: vi.fn(),
            });
        }),
        setupProjectionBridge: vi.fn(() => vi.fn()),
        mutateCrdtDoc: vi.fn(),
        removeCrdtDoc: vi.fn(),
        createCrdtDoc: vi.fn(),
        branchStoreValue: { value: { branches: [] } },
        branchStoreSubscribe: vi.fn(() => vi.fn()),
        branchStoreSet: vi.fn(),
    };
});

// Use exact relative paths as in sessionManagement.ts
vi.mock('../../../repositories/peerConnection', () => ({
    PeerConnectionManager: mocks.PeerConnectionManager,
}));

vi.mock('../../automergeSync', () => ({
    AutomergeSync: mocks.AutomergeSync,
}));

vi.mock('../../assetTransfer', () => ({
    AssetTransfer: mocks.AssetTransfer,
}));

vi.mock('../../permissions', () => ({
    PermissionManager: mocks.PermissionManager,
}));

vi.mock('../../../stores/collaborationStore', () => ({
    collaborationStore: {
        get value() {
            return mocks.collaborationStoreValue.value;
        },
        set: mocks.collaborationStoreSet,
        update: (updater: (current: Record<string, unknown>) => Record<string, unknown>) => {
            mocks.collaborationStoreSet(updater(mocks.collaborationStoreValue.value));
        },
    },
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    setupProjectionBridge: mocks.setupProjectionBridge,
    mutateCrdtDoc: mocks.mutateCrdtDoc,
    removeCrdtDoc: mocks.removeCrdtDoc,
    createCrdtDoc: mocks.createCrdtDoc,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    branchStore: {
        get value() {
            return mocks.branchStoreValue.value;
        },
        subscribe: mocks.branchStoreSubscribe,
        set: mocks.branchStoreSet,
    },
}));

describe('collaboration sessionManagement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.collaborationStoreValue.value = {};
    });

    it('createSession initializes sub-systems and updates store', () => {
        const sessionId = createSession('Alice');

        expect(sessionId).toBeDefined();
        expect(mocks.PeerConnectionManager).toHaveBeenCalled();
        expect(mocks.automergeStart).toHaveBeenCalled();
        expect(mocks.setupProjectionBridge).toHaveBeenCalled();

        expect(mocks.collaborationStoreSet).toHaveBeenCalledWith(
            expect.objectContaining({
                isEnabled: true,
                localName: 'Alice',
                isHost: true,
            })
        );
    });

    it('leaveSession cleans up sub-systems and resets store', async () => {
        mocks.collaborationStoreValue.value = {
            localPeerId: 'p1',
        } as unknown as typeof mocks.collaborationStoreValue.value;

        // Setup existing session state
        createSession('Alice');

        // §fix-11 — leaveSession is now async (it flushes the buffered
        // peer-leave before tearing channels down); await it before asserting.
        await leaveSession();

        expect(mocks.collaborationStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isEnabled: false,
                sessionId: null,
                peers: [],
            })
        );
    });

    describe('incoming peer-message handling (security)', () => {
        type Peer = { id: string; name: string; color: string; isHost: boolean };
        // Drive a message through the captured onMessage callback.
        function deliver(peerId: string, message: unknown): void {
            mocks.peerCallbacks.onMessage?.({ peerId, message });
        }
        function setStore(state: Record<string, unknown>): void {
            mocks.collaborationStoreValue.value = state;
        }
        function peers(): Peer[] {
            return (mocks.collaborationStoreValue.value.peers as Peer[] | undefined) ?? [];
        }

        beforeEach(() => {
            // createSession wires handlePeerMessage as the onMessage callback.
            createSession('Host');
        });

        it('§fix-2 a non-host peer cannot promote itself to host via peer-info', () => {
            setStore({
                isEnabled: true,
                localPeerId: 'host',
                isHost: true,
                peers: [{ id: 'evil', name: 'Evil', color: '#000', isHost: false }],
            });

            deliver('evil', {
                type: 'peer-info',
                peer: { id: 'evil', name: 'Evil', color: '#000', isHost: true },
            });

            expect(peers().find((peer) => peer.id === 'evil')?.isHost).toBe(false);
        });

        it('§fix-3 a peer-leave naming a third party is ignored (only self-leave honored)', () => {
            setStore({
                isEnabled: true,
                localPeerId: 'host',
                isHost: true,
                peers: [
                    { id: 'evil', name: 'Evil', color: '#000', isHost: false },
                    { id: 'victim', name: 'Victim', color: '#111', isHost: false },
                ],
            });

            // 'evil' tries to eject 'victim'.
            deliver('evil', { type: 'peer-leave', peerId: 'victim' });

            expect(peers().some((peer) => peer.id === 'victim')).toBe(true);
        });

        it('§fix-3 a self peer-leave is honored', () => {
            setStore({
                isEnabled: true,
                localPeerId: 'host',
                isHost: true,
                peers: [{ id: 'leaver', name: 'Leaver', color: '#000', isHost: false }],
            });

            deliver('leaver', { type: 'peer-leave', peerId: 'leaver' });

            expect(peers().some((peer) => peer.id === 'leaver')).toBe(false);
        });

        it('§fix-16 a joiner adopts the host-assigned color from the host peer-info', () => {
            setStore({
                isEnabled: true,
                localPeerId: 'me',
                localColor: '#aaaaaa', // locally-picked color
                isHost: false,
                peers: [{ id: 'host', name: 'Host', color: '#3b82f6', isHost: true }],
            });

            // The host tells us our assigned color (peer.id === our localPeerId).
            deliver('host', {
                type: 'peer-info',
                peer: { id: 'me', name: 'Me', color: '#22c55e', isHost: false },
            });

            expect(mocks.collaborationStoreValue.value.localColor).toBe('#22c55e');
        });

        it('§fix-16 a non-host peer cannot reassign the local color', () => {
            setStore({
                isEnabled: true,
                localPeerId: 'me',
                localColor: '#aaaaaa',
                isHost: false,
                peers: [
                    { id: 'host', name: 'Host', color: '#3b82f6', isHost: true },
                    { id: 'evil', name: 'Evil', color: '#000', isHost: false },
                ],
            });

            // 'evil' (not host) tries to reassign our color.
            deliver('evil', {
                type: 'peer-info',
                peer: { id: 'me', name: 'Me', color: '#ff0000', isHost: false },
            });

            expect(mocks.collaborationStoreValue.value.localColor).toBe('#aaaaaa');
        });
    });
});
