import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createSession, leaveSession, onPresence } from '../sessionManagement';

type TestClip = {
    id: string;
    assetHash?: string;
    audioBufferId?: string;
};

type TestTrack = {
    clips: TestClip[];
};

type TestTrackStoreState = {
    tracks: TestTrack[];
};

type TestBranchRecord = {
    branchId: string;
    name: string;
    rootDocId: string;
    sourceBranchId: string | null;
    createdAt: number;
    createdFromHeads: string[];
    note: string;
};

type TestBranchStoreState = {
    branches: TestBranchRecord[];
    activeBranchId: string;
};

type AssetTransferCallbacks = {
    onAssetAvailable?: (hash: string) => void;
};

function createTestBranch(branchId: string): TestBranchRecord {
    return {
        branchId,
        name: branchId === 'main' ? 'Main' : branchId,
        rootDocId: branchId === 'main' ? 'root' : `root-${branchId}`,
        sourceBranchId: branchId === 'main' ? null : 'main',
        createdAt: 1,
        createdFromHeads: [],
        note: '',
    };
}

const mocks = vi.hoisted(() => {
    const automergeStart = vi.fn();
    const collaborationStoreValue = { value: {} as Record<string, unknown> };
    const trackStoreValue: { value: TestTrackStoreState | null } = { value: { tracks: [] } };
    const branchStoreValue: { value: TestBranchStoreState | null } = {
        value: { branches: [], activeBranchId: 'main' },
    };
    const assetTransferCallbacks: AssetTransferCallbacks = {};
    const crdtChangeListener: { value: ((docId?: string) => void) | undefined } = { value: undefined };
    const assetTransferGetAsset = vi.fn<(hash: string) => Blob | null | undefined>();
    const audioContextDecodeAudioData = vi.fn<(audioData: ArrayBuffer) => Promise<AudioBuffer>>();
    const getAudioContext = vi.fn(() => ({
        decodeAudioData: audioContextDecodeAudioData,
    }));
    const getCachedAudioBuffer = vi.fn<(input: { bufferId: string }) => AudioBuffer | null>();
    const cacheAudioBuffer = vi.fn<(input: { buffer: AudioBuffer; bufferId?: string }) => string>();
    const getCrdtDoc = vi.fn();
    const hasCrdtDoc = vi.fn(() => true);
    const persistCrdtProject = vi.fn(() => Promise.resolve());
    const preserveBranchStateForSession = vi.fn();
    const replaceBranchState = vi.fn();
    const restoreBranchStateAfterSession = vi.fn();
    const subscribeToCrdtChanges = vi.fn((listener: (docId?: string) => void) => {
        crdtChangeListener.value = listener;
        return vi.fn();
    });
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
        AssetTransfer: vi.fn(function AssetTransferMock(
            this: Record<string, unknown>,
            _peerManager: unknown,
            callbacks: AssetTransferCallbacks
        ) {
            assetTransferCallbacks.onAssetAvailable = callbacks.onAssetAvailable;
            Object.assign(this, {
                getAsset: assetTransferGetAsset,
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
        branchStoreValue,
        branchStoreSubscribe: vi.fn(() => vi.fn()),
        crdtChangeListener,
        getCrdtDoc,
        hasCrdtDoc,
        persistCrdtProject,
        preserveBranchStateForSession,
        replaceBranchState,
        restoreBranchStateAfterSession,
        subscribeToCrdtChanges,
        trackStoreValue,
        assetTransferCallbacks,
        assetTransferGetAsset,
        audioContextDecodeAudioData,
        getAudioContext,
        getCachedAudioBuffer,
        cacheAudioBuffer,
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

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: {
        get value() {
            return mocks.trackStoreValue.value;
        },
    },
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getAudioContext: mocks.getAudioContext,
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
    cacheAudioBuffer: mocks.cacheAudioBuffer,
}));

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    setupProjectionBridge: mocks.setupProjectionBridge,
    mutateCrdtDoc: mocks.mutateCrdtDoc,
    removeCrdtDoc: mocks.removeCrdtDoc,
    createCrdtDoc: mocks.createCrdtDoc,
    getCrdtDoc: mocks.getCrdtDoc,
    hasCrdtDoc: mocks.hasCrdtDoc,
    persistCrdtProject: mocks.persistCrdtProject,
    preserveBranchStateForSession: mocks.preserveBranchStateForSession,
    replaceBranchState: mocks.replaceBranchState,
    restoreBranchStateAfterSession: mocks.restoreBranchStateAfterSession,
    subscribeToCrdtChanges: mocks.subscribeToCrdtChanges,
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    branchStore: {
        get value() {
            return mocks.branchStoreValue.value;
        },
        subscribe: mocks.branchStoreSubscribe,
    },
    MAIN_BRANCH_ID: 'main',
}));

function createTestAudioBuffer(): AudioBuffer {
    const channel_data = new Float32Array(128);
    return {
        copyFromChannel: (destination, _channel_number, start_in_channel = 0) => {
            destination.set(channel_data.subarray(start_in_channel, start_in_channel + destination.length));
        },
        copyToChannel: (source, _channel_number, start_in_channel = 0) => {
            channel_data.set(source, start_in_channel);
        },
        duration: channel_data.length / 48_000,
        getChannelData: () => channel_data,
        length: channel_data.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
    };
}

async function flushAssetResolution(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

function getAssetAvailableCallback(): (hash: string) => void {
    const callback = mocks.assetTransferCallbacks.onAssetAvailable;
    if (!callback) {
        throw new Error('Expected AssetTransfer onAssetAvailable callback to be captured');
    }
    return callback;
}

function getBranchProjectionListener(): (docId?: string) => void {
    const listener = mocks.crdtChangeListener.value;
    if (!listener) {
        throw new Error('Expected branch projection listener to be captured');
    }
    return listener;
}

describe('collaboration sessionManagement', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.collaborationStoreValue.value = {};
        mocks.trackStoreValue.value = { tracks: [] };
        mocks.branchStoreValue.value = { branches: [], activeBranchId: 'main' };
        mocks.crdtChangeListener.value = undefined;
        mocks.getCrdtDoc.mockReset();
        mocks.hasCrdtDoc.mockReset();
        mocks.hasCrdtDoc.mockReturnValue(true);
        mocks.persistCrdtProject.mockReset();
        mocks.persistCrdtProject.mockResolvedValue(undefined);
        mocks.preserveBranchStateForSession.mockReset();
        mocks.replaceBranchState.mockReset();
        mocks.restoreBranchStateAfterSession.mockReset();
        mocks.assetTransferCallbacks.onAssetAvailable = undefined;
        mocks.assetTransferGetAsset.mockReset();
        mocks.audioContextDecodeAudioData.mockReset();
        mocks.getAudioContext.mockReset();
        mocks.getCachedAudioBuffer.mockReset();
        mocks.cacheAudioBuffer.mockReset();
        mocks.getAudioContext.mockReturnValue({
            decodeAudioData: mocks.audioContextDecodeAudioData,
        });
        mocks.getCachedAudioBuffer.mockReturnValue(null);
        mocks.cacheAudioBuffer.mockImplementation(({ bufferId }) => bufferId ?? 'generated-test-buffer');
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

    describe('branch synchronization', () => {
        it('should preserve the current active branch when the incoming projection contains it', () => {
            const mainBranch = createTestBranch('main');
            const featureBranch = createTestBranch('feature');
            mocks.branchStoreValue.value = {
                branches: [mainBranch, featureBranch],
                activeBranchId: 'feature',
            };
            mocks.getCrdtDoc.mockReturnValue({ branches: [mainBranch, featureBranch] });

            createSession('Alice');
            getBranchProjectionListener()('__branches__');

            expect(mocks.replaceBranchState).toHaveBeenLastCalledWith({
                branches: [mainBranch, featureBranch],
                activeBranchId: 'feature',
            });
        });

        it('should delegate active-id fallback to CrdtDocument after passing the current local id', () => {
            const mainBranch = createTestBranch('main');
            const localBranch = createTestBranch('local');
            const featureBranch = createTestBranch('feature');
            mocks.branchStoreValue.value = {
                branches: [mainBranch, localBranch],
                activeBranchId: 'local',
            };
            mocks.getCrdtDoc.mockReturnValue({ branches: [mainBranch, featureBranch] });

            createSession('Alice');
            getBranchProjectionListener()('__branches__');

            expect(mocks.replaceBranchState).toHaveBeenLastCalledWith({
                branches: [mainBranch, featureBranch],
                activeBranchId: 'local',
            });
        });

        it('should preserve branch state before the first incoming projection', () => {
            const mainBranch = createTestBranch('main');
            const featureBranch = createTestBranch('feature');
            mocks.branchStoreValue.value = {
                branches: [mainBranch, featureBranch],
                activeBranchId: 'feature',
            };
            mocks.getCrdtDoc.mockReturnValue({ branches: [mainBranch, featureBranch] });

            createSession('Alice');
            getBranchProjectionListener()('__branches__');

            expect(mocks.preserveBranchStateForSession).toHaveBeenCalledTimes(1);
            expect(mocks.preserveBranchStateForSession.mock.invocationCallOrder[0]).toBeLessThan(
                mocks.replaceBranchState.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY
            );
        });

        it('should pass malformed remote branches to CrdtDocument without dereferencing them', () => {
            const mainBranch = createTestBranch('main');
            const localBranch = createTestBranch('local');
            const malformedBranches = [null, { branchId: 'incomplete' }];
            mocks.branchStoreValue.value = {
                branches: [mainBranch, localBranch],
                activeBranchId: 'local',
            };
            mocks.getCrdtDoc.mockReturnValue({ branches: malformedBranches });

            createSession('Alice');

            expect(() => getBranchProjectionListener()('__branches__')).not.toThrow();
            expect(mocks.replaceBranchState).toHaveBeenLastCalledWith({
                branches: malformedBranches,
                activeBranchId: 'local',
            });
        });

        it('should restore durable branch state when leaving', async () => {
            const mainBranch = createTestBranch('main');
            const localBranch = createTestBranch('local');
            const featureBranch = createTestBranch('feature');
            mocks.branchStoreValue.value = {
                branches: [mainBranch, localBranch],
                activeBranchId: 'local',
            };

            createSession('Alice');
            mocks.restoreBranchStateAfterSession.mockClear();
            mocks.branchStoreValue.value = {
                branches: [mainBranch, featureBranch],
                activeBranchId: 'feature',
            };

            await leaveSession();

            expect(mocks.restoreBranchStateAfterSession).toHaveBeenCalledTimes(1);
        });
    });

    describe('asset resolution', () => {
        it('should decode a matching transferred asset and cache it through AudioEngine use cases', async () => {
            const decodedAudioBuffer = createTestAudioBuffer();
            const assetBlob = new Blob([new Uint8Array([1, 2, 3])]);
            mocks.trackStoreValue.value = {
                tracks: [
                    {
                        clips: [
                            { id: 'clip-1', assetHash: 'asset-hash-1', audioBufferId: 'buffer-1' },
                            { id: 'clip-2', assetHash: 'other-asset-hash', audioBufferId: 'buffer-2' },
                        ],
                    },
                ],
            };
            mocks.assetTransferGetAsset.mockReturnValue(assetBlob);
            mocks.audioContextDecodeAudioData.mockResolvedValue(decodedAudioBuffer);

            createSession('Host');
            getAssetAvailableCallback()('asset-hash-1');
            await flushAssetResolution();

            expect(mocks.assetTransferGetAsset).toHaveBeenCalledWith('asset-hash-1');
            expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buffer-1' });
            expect(mocks.audioContextDecodeAudioData).toHaveBeenCalledTimes(1);
            expect(mocks.cacheAudioBuffer).toHaveBeenCalledWith({
                bufferId: 'buffer-1',
                buffer: decodedAudioBuffer,
            });
        });

        it('should skip decoding when the matching asset buffer is already cached', async () => {
            const cachedAudioBuffer = createTestAudioBuffer();
            const assetBlob = new Blob([new Uint8Array([1, 2, 3])]);
            mocks.trackStoreValue.value = {
                tracks: [
                    {
                        clips: [{ id: 'clip-1', assetHash: 'asset-hash-1', audioBufferId: 'buffer-1' }],
                    },
                ],
            };
            mocks.assetTransferGetAsset.mockReturnValue(assetBlob);
            mocks.getCachedAudioBuffer.mockReturnValue(cachedAudioBuffer);

            createSession('Host');
            getAssetAvailableCallback()('asset-hash-1');
            await flushAssetResolution();

            expect(mocks.getCachedAudioBuffer).toHaveBeenCalledWith({ bufferId: 'buffer-1' });
            expect(mocks.audioContextDecodeAudioData).not.toHaveBeenCalled();
            expect(mocks.cacheAudioBuffer).not.toHaveBeenCalled();
        });
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

        it('sanitizes a malformed peer-supplied presence color to a safe fallback', () => {
            setStore({
                isEnabled: true,
                localPeerId: 'host',
                isHost: true,
                peers: [{ id: 'evil', name: 'Evil', color: '#000', isHost: false }],
            });

            const received: string[] = [];
            const unsubscribe = onPresence((data) => {
                received.push(data.color);
            });

            // A 32-char string that fits the length cap but is not a CSS color —
            // it would otherwise interpolate verbatim into the playhead gradient
            // CSS at PresenceMarker.tsx:25.
            const injection = 'red;}#a{background:url(x)}';
            deliver('evil', {
                type: 'presence',
                data: { peerId: 'evil', name: 'Evil', color: injection, playheadBeat: 1 },
            });

            unsubscribe();

            expect(received).toHaveLength(1);
            expect(received[0]).not.toBe(injection);
            expect(received[0]).toBe('#888888');
        });

        it('passes a well-formed peer-supplied presence color through unchanged', () => {
            setStore({
                isEnabled: true,
                localPeerId: 'host',
                isHost: true,
                peers: [{ id: 'p2', name: 'Peer', color: '#000', isHost: false }],
            });

            const received: string[] = [];
            const unsubscribe = onPresence((data) => {
                received.push(data.color);
            });

            deliver('p2', {
                type: 'presence',
                data: { peerId: 'p2', name: 'Peer', color: '#22c55e', playheadBeat: 1 },
            });

            unsubscribe();

            expect(received).toEqual(['#22c55e']);
        });
    });
});
