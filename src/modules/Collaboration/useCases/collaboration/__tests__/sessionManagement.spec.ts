import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSession, leaveSession } from '../sessionManagement';

const mocks = vi.hoisted(() => {
    const automergeStart = vi.fn();
    return {
        collaborationStoreValue: { value: {} },
        collaborationStoreSet: vi.fn(),
        automergeStart,
        PeerConnectionManager: vi.fn(function PeerConnectionManagerMock(this: Record<string, unknown>) {
            Object.assign(this, {
                closeAll: vi.fn(),
                getConnectedPeerIds: vi.fn(() => []),
                broadcastCrdtSync: vi.fn(),
                broadcastPresence: vi.fn(),
                sendCrdtSync: vi.fn(),
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
    },
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<any>()),
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

    it('leaveSession cleans up sub-systems and resets store', () => {
        mocks.collaborationStoreValue.value = { localPeerId: 'p1' } as any;

        // Setup existing session state
        createSession('Alice');

        leaveSession();

        expect(mocks.collaborationStoreSet).toHaveBeenLastCalledWith(
            expect.objectContaining({
                isEnabled: false,
                sessionId: null,
                peers: [],
            })
        );
    });
});
