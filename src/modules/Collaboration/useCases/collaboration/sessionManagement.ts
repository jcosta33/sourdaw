import {
    type PeerId,
    type PeerInfo,
    type PeerMessage,
    type PresenceData,
    type SignalingMessage,
    PEER_COLORS,
} from '../../models/CollaborationTypes';
import { transportStore } from '#/modules/Transport/stores/transportStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { audioBufferCache } from '#/modules/AudioEngine/stores/audioBufferCache';
import { getAudioContext } from '#/modules/AudioEngine/useCases/engineAccess';

import { setupProjectionBridge } from '#/modules/CrdtDocument/useCases/projection/projectProjection';
import { branchStore } from '#/modules/CrdtDocument/stores/branchStore';
import { subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases/subscribeToCrdtChanges';
import { getCrdtDoc } from '#/modules/CrdtDocument/useCases/getCrdtDoc';
import { createCrdtDoc } from '#/modules/CrdtDocument/useCases/createCrdtDoc';
import { hasCrdtDoc } from '#/modules/CrdtDocument/useCases/hasCrdtDoc';
import { removeCrdtDoc } from '#/modules/CrdtDocument/useCases/removeCrdtDoc';
import { mutateCrdtDoc } from '#/modules/CrdtDocument/useCases/mutateCrdtDoc';
import { persistCrdtProject } from '#/modules/CrdtDocument/useCases/crdtProjectLifecycle';
import { collaborationStore } from '../../stores/collaborationStore';
import { PeerConnectionManager } from '../../repositories/peerConnection';
import { AutomergeSync } from '../automergeSync';
import { AssetTransfer } from '../assetTransfer';
import { PermissionManager } from '../permissions';

const DOC_BRANCHES = '__branches__';
const MAIN_BRANCH_ID = 'main';

type LocalBranchRecord = {
    branchId: string;
    name: string;
    rootDocId: string;
    sourceBranchId: string | null;
    createdAt: number;
    createdFromHeads: string[];
    note: string;
};

type LocalBranchState = {
    branches: LocalBranchRecord[];
    activeBranchId: string;
};

let peerManager: PeerConnectionManager | null = null;
let automergeSync: AutomergeSync | null = null;
let assetTransfer: AssetTransfer | null = null;
let permissionManager: PermissionManager | null = null;
let cleanupProjectionBridge: (() => void) | null = null;
let presenceListeners = new Set<(data: PresenceData) => void>();
let playheadBroadcastInterval: ReturnType<typeof setInterval> | null = null;
/** Tracks the host-assigned peer slot ID for the in-flight invite, if any. */
let pendingInviteId: PeerId | null = null;
/** Cleanup timers for peers that disconnected without sending peer-leave. */
const peerCleanupTimers = new Map<PeerId, ReturnType<typeof setTimeout>>();

// -- Branch sync state --
/** Snapshot of branchStore taken at session start; restored on session end. */
let branchStoreSnapshot: LocalBranchState | null = null;
/** Unsubscribe from branchStore changes (local mutations → Automerge doc). */
let unsubscribeBranchStore: (() => void) | null = null;
/** Unsubscribe from automergeRepository changes (__branches__ doc → branchStore). */
let unsubscribeAutomergeChanges: (() => void) | null = null;
/**
 * Guard flag to prevent infinite update loop:
 * projecting __branches__ → branchStore triggers branchStore.subscribe,
 * which must not write back to the Automerge doc.
 */
let isProjectingBranches = false;

const PEER_CLEANUP_DELAY_MS = 15_000;

const PLAYHEAD_BROADCAST_HZ = 4;

// -- Branch sync helpers --

/**
 * Start session-scoped branch metadata sync.
 *
 * For the host: seeds the `__branches__` Automerge doc with current branch list.
 * For joiners: the doc is created on first receipt of a sync message from the host.
 *
 * During the session:
 *  - Local branch mutations (fork/delete/etc.) are mirrored into the Automerge doc
 *    so peers receive them via the normal sync protocol.
 *  - Incoming `__branches__` doc changes from peers are projected back into branchStore
 *    (in-memory only — we restore the pre-session snapshot on leave).
 *
 * Only `branches` is synced; `activeBranchId` is per-peer and never shared.
 */
const startBranchSync = (isHost: boolean): void => {
    // Snapshot current state so we can restore it on session end.
    branchStoreSnapshot = branchStore.value ? { ...branchStore.value, branches: [...branchStore.value.branches] } : null;

    if (isHost) {
        // Seed the metadata doc. Remove any stale doc from a previous session first.
        removeCrdtDoc(DOC_BRANCHES);
        createCrdtDoc(DOC_BRANCHES);
        const currentBranches = branchStore.value?.branches ?? [];
        mutateCrdtDoc({
            id: DOC_BRANCHES,
            changeFn: (doc: Record<string, unknown>) => {
                doc['branches'] = currentBranches;
            },
        });
    }
    // For joiners, the doc is created on demand in AutomergeSync.receiveSync.

    // Mirror local branch mutations into the Automerge doc.
    unsubscribeBranchStore = branchStore.subscribe((state) => {
        if (isProjectingBranches || !state) {
            return;
        }
        if (!hasCrdtDoc(DOC_BRANCHES)) {
            return;
        }
        mutateCrdtDoc({
            id: DOC_BRANCHES,
            changeFn: (doc: Record<string, unknown>) => {
                doc['branches'] = state.branches;
            },
        });
    });

    // Project incoming __branches__ doc changes back into branchStore.
    unsubscribeAutomergeChanges = subscribeToCrdtChanges(() => {
        const doc = getCrdtDoc<{ branches: LocalBranchState['branches'] }>(DOC_BRANCHES);
        if (!doc?.branches) {
            return;
        }
        const current = branchStore.value;
        const incomingBranches = Array.from(doc.branches);
        const activeBranchId = current?.activeBranchId ?? MAIN_BRANCH_ID;
        // Only update if the branches list actually changed (avoid spurious writes).
        const currentJson = JSON.stringify(current?.branches ?? []);
        const incomingJson = JSON.stringify(incomingBranches);
        if (currentJson === incomingJson) {
            return;
        }
        isProjectingBranches = true;
        try {
            // Keep the peer's own activeBranchId — don't force them onto the host's branch.
            const validActiveBranchId = incomingBranches.some((branch) => branch.branchId === activeBranchId)
                ? activeBranchId
                : MAIN_BRANCH_ID;
            branchStore.set({ branches: incomingBranches, activeBranchId: validActiveBranchId });
        } finally {
            isProjectingBranches = false;
        }
    });
};

/**
 * Stop branch sync and restore the pre-session branchStore state.
 * Removes the `__branches__` Automerge doc so it isn't included in future saves.
 */
const stopBranchSync = (): void => {
    if (unsubscribeBranchStore) {
        unsubscribeBranchStore();
        unsubscribeBranchStore = null;
    }
    if (unsubscribeAutomergeChanges) {
        unsubscribeAutomergeChanges();
        unsubscribeAutomergeChanges = null;
    }

    removeCrdtDoc(DOC_BRANCHES);

    if (branchStoreSnapshot) {
        isProjectingBranches = true;
        try {
            branchStore.set(branchStoreSnapshot);
        } finally {
            isProjectingBranches = false;
        }
        branchStoreSnapshot = null;
    }

    // Persist without the __branches__ doc so IDB stays clean.
    persistCrdtProject().catch((error) => {
        console.error('[Collaboration] Failed to persist after branch sync cleanup:', error);
    });
};

const generatePeerId = (): PeerId => crypto.randomUUID();
const generateSessionId = (): string => crypto.randomUUID().slice(0, 8);

/** Pick the first color from PEER_COLORS not already in use. */
const pickPeerColor = (excludeColors: string[]): string => {
    const used = new Set(excludeColors);
    return PEER_COLORS.find((c) => !used.has(c)) ?? PEER_COLORS[0]!;
};

const getLocalPeerInfo = (): PeerInfo => {
    const state = collaborationStore.value!;
    return {
        id: state.localPeerId!,
        name: state.localName,
        color: state.localColor,
        isHost: state.isHost,
        isConnected: true,
        lastSeen: Date.now(),
        latencyMs: null,
    };
};

/**
 * Create a new collaboration session as host.
 * Returns the session ID.
 */
export const createSession = (name: string): string => {
    // Clean up any existing session first
    cleanupSubsystems();

    const peerId = generatePeerId();
    const sessionId = generateSessionId();
    const color = pickPeerColor([]);

    peerManager = new PeerConnectionManager({
        onMessage: handlePeerMessage,
        onConnected: handlePeerConnected,
        onDisconnected: handlePeerDisconnected,
    });

    automergeSync = new AutomergeSync(peerManager);
    automergeSync.start();
    cleanupProjectionBridge = setupProjectionBridge();

    assetTransfer = new AssetTransfer(peerManager, {
        onAssetAvailable: (hash) => {
            void resolveAssetForClips(hash);
        },
        onProgress: (_hash, _received, _total) => {
            // Could update a UI progress indicator.
        },
    });

    permissionManager = new PermissionManager(peerManager);
    startPlayheadBroadcast();
    startBranchSync(true);

    collaborationStore.set({
        isEnabled: true,
        sessionId,
        localPeerId: peerId,
        localName: name,
        localColor: color,
        isHost: true,
        peers: [],
        connectionStatus: 'disconnected',
        error: null,
    });

    return sessionId;
};

/**
 * Generate an invite string containing the SDP offer for a new peer.
 * The host calls this, copies the result, and the joiner pastes it into `joinSession`.
 */
export const generateInvite = async (): Promise<string> => {
    if (!peerManager) {
        throw new Error('No active session');
    }

    // Clean up any previously generated invite that was never answered.
    if (pendingInviteId) {
        peerManager.removePeer(pendingInviteId);
        pendingInviteId = null;
    }

    const joinerPeerId = generatePeerId();
    pendingInviteId = joinerPeerId;
    const peer = peerManager.createPeer(joinerPeerId);
    const sdp = await peer.createOffer();

    const state = collaborationStore.value!;
    const invite: SignalingMessage = {
        type: 'offer',
        peerId: state.localPeerId!,
        name: state.localName,
        sessionId: state.sessionId!,
        sdp,
        pendingPeerId: joinerPeerId,
    };

    return await compressInvite(JSON.stringify(invite));
};

/**
 * Join a session by pasting an invite string.
 * Returns an answer string to send back to the host.
 */
export const joinSession = async (inviteString: string, name: string): Promise<string> => {
    cleanupSubsystems();

    if (!inviteString.trim()) {
        throw new Error('Invite string is empty');
    }

    let invite: SignalingMessage;
    try {
        const json = await decompressInvite(inviteString.trim());
        invite = JSON.parse(json) as SignalingMessage;
    } catch {
        throw new Error('Invalid invite — must be a valid invite string');
    }

    if (invite.type !== 'offer') {
        throw new Error('Invalid invite: expected offer');
    }

    const peerId = generatePeerId();
    // Pick a color that doesn't clash with the host's (always the first color).
    const color = pickPeerColor([PEER_COLORS[0]!]);

    peerManager = new PeerConnectionManager({
        onMessage: handlePeerMessage,
        onConnected: handlePeerConnected,
        onDisconnected: handlePeerDisconnected,
    });

    automergeSync = new AutomergeSync(peerManager);
    automergeSync.start();
    cleanupProjectionBridge = setupProjectionBridge();

    assetTransfer = new AssetTransfer(peerManager, {
        onAssetAvailable: (hash) => {
            void resolveAssetForClips(hash);
        },
        onProgress: (_hash, _received, _total) => {},
    });

    permissionManager = new PermissionManager(peerManager);
    startPlayheadBroadcast();
    startBranchSync(false);

    const peer = peerManager.createPeer(invite.peerId);
    const answerSdp = await peer.acceptOffer(invite.sdp);

    collaborationStore.set({
        isEnabled: true,
        sessionId: invite.sessionId,
        localPeerId: peerId,
        localName: name,
        localColor: color,
        isHost: false,
        peers: [{
            id: invite.peerId,
            name: invite.name,
            color: PEER_COLORS[0]!,
            isHost: true,
            isConnected: false,
            lastSeen: Date.now(),
            latencyMs: null,
        }],
        connectionStatus: 'connecting',
        error: null,
    });

    const answer: SignalingMessage = {
        type: 'answer',
        peerId,
        name,
        sdp: answerSdp,
        pendingPeerId: invite.pendingPeerId,
    };

    return await compressInvite(JSON.stringify(answer));
};

/**
 * Accept an answer from a joiner (host side, completes the connection).
 */
export const acceptAnswer = async (answerString: string): Promise<void> => {
    const json = await decompressInvite(answerString);
    const answer = JSON.parse(json) as SignalingMessage;
    if (answer.type !== 'answer') {
        throw new Error('Invalid answer');
    }

    if (!peerManager) {
        throw new Error('No active session');
    }

    const peer = peerManager.getPeer(answer.pendingPeerId);
    if (!peer) {
        throw new Error('No pending peer connection matches this answer — the invite may have expired');
    }

    await peer.acceptAnswer(answer.sdp);
    pendingInviteId = null;

    // Add the joiner to our peer list
    const state = collaborationStore.value;
    if (state) {
        const joinerInfo: PeerInfo = {
            id: answer.peerId,
            name: answer.name,
            color: pickPeerColor([state.localColor, ...state.peers.map((p) => p.color)]),
            isHost: false,
            isConnected: false,
            lastSeen: Date.now(),
            latencyMs: null,
        };
        collaborationStore.set({
            ...state,
            peers: [...state.peers, joinerInfo],
        });
    }
};

/** Tear down all subsystems without changing store state. */
const cleanupSubsystems = (): void => {
    pendingInviteId = null;
    stopPlayheadBroadcast();
    stopBranchSync();
    for (const timer of peerCleanupTimers.values()) {
        clearTimeout(timer);
    }
    peerCleanupTimers.clear();
    if (automergeSync) {
        automergeSync.stop();
        automergeSync = null;
    }
    if (cleanupProjectionBridge) {
        cleanupProjectionBridge();
        cleanupProjectionBridge = null;
    }
    if (permissionManager) {
        permissionManager.clear();
        permissionManager = null;
    }
    assetTransfer = null;
    if (peerManager) {
        peerManager.closeAll();
        peerManager = null;
    }
    presenceListeners.clear();
};

// -- Asset resolution --

/**
 * When a peer sends us an audio asset, find all clips that reference its hash
 * and decode the blob into the audioBufferCache under their audioBufferId.
 * This lets the scheduler play the clip on the next playback start.
 */
async function resolveAssetForClips(hash: string): Promise<void> {
    const blob = assetTransfer?.getAsset(hash);
    if (!blob) {
        return;
    }

    const tracks = trackStore.value?.tracks ?? [];
    let ctx: BaseAudioContext;
    try {
        ctx = getAudioContext();
    } catch {
        return;
    }

    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.assetHash !== hash || !clip.audioBufferId) {
                continue;
            }
            if (audioBufferCache.has(clip.audioBufferId)) {
                continue;
            }
            try {
                const arrayBuffer = await blob.arrayBuffer();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                audioBufferCache.set(clip.audioBufferId, audioBuffer);
            } catch {
                console.error('[Collaboration] Failed to decode asset for clip', clip.id);
            }
        }
    }
}

// -- Playhead broadcast --

const startPlayheadBroadcast = (): void => {
    playheadBroadcastInterval = setInterval(() => {
        if (!peerManager || peerManager.getConnectedPeerIds().length === 0) {
            return;
        }
        const state = collaborationStore.value;
        if (!state?.localPeerId) {
            return;
        }
        const playheadBeat = transportStore.value?.playheadPosition ?? null;
        peerManager.broadcastPresence({
            type: 'presence',
            data: {
                peerId: state.localPeerId,
                name: state.localName,
                color: state.localColor,
                view: 'arrangement',
                cursorBeat: null,
                cursorTrackId: null,
                selectedClipIds: [],
                selectedNoteIds: [],
                viewportStartBeat: 0,
                viewportEndBeat: 0,
                viewportTrackIds: [],
                action: null,
                playheadBeat,
            },
        });
    }, 1000 / PLAYHEAD_BROADCAST_HZ);
};

const stopPlayheadBroadcast = (): void => {
    if (playheadBroadcastInterval !== null) {
        clearInterval(playheadBroadcastInterval);
        playheadBroadcastInterval = null;
    }
};

/**
 * Leave the current session.
 */
export const leaveSession = (): void => {
    if (peerManager) {
        peerManager.broadcastCrdtSync({
            type: 'peer-leave',
            peerId: collaborationStore.value?.localPeerId ?? '',
        });
    }

    cleanupSubsystems();

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
    });
};

/**
 * Broadcast local presence data to all peers.
 */
export const broadcastPresence = (data: Omit<PresenceData, 'peerId' | 'name' | 'color'>): void => {
    if (!peerManager) {
        return;
    }

    const state = collaborationStore.value;
    if (!state?.localPeerId) {
        return;
    }

    peerManager.broadcastPresence({
        type: 'presence',
        data: {
            ...data,
            peerId: state.localPeerId,
            name: state.localName,
            color: state.localColor,
        },
    });
};

/**
 * Subscribe to incoming presence data from peers.
 */
export const onPresence = (listener: (data: PresenceData) => void): (() => void) => {
    presenceListeners.add(listener);
    return () => {
        presenceListeners.delete(listener);
    };
};

/** Get the asset transfer instance (for requesting/providing assets). */
export const getAssetTransfer = (): AssetTransfer | null => assetTransfer;

/** Get the permission manager instance (for role checks). */
export const getPermissionManager = (): PermissionManager | null => permissionManager;

// -- Internal handlers --

type HandlePeerMessageInput = { peerId: PeerId; message: PeerMessage };
const handlePeerMessage = ({ peerId, message }: HandlePeerMessageInput): void => {
    if (message.type === 'crdt-sync') {
        // Route by docId to the appropriate subsystem
        if (message.docId === '__asset__') {
            void assetTransfer?.handleMessage(peerId, message);
        } else if (message.docId === '__permissions__') {
            permissionManager?.handleMessage(peerId, message);
        } else {
            automergeSync?.handlePeerMessage({ peerId, message });
        }
    } else if (message.type === 'presence') {
        for (const listener of presenceListeners) {
            listener(message.data);
        }
        updatePeerLastSeen(peerId);
    } else if (message.type === 'peer-info') {
        addOrUpdatePeer(message.peer);
    } else if (message.type === 'peer-leave') {
        removePeer(message.peerId);
    }
};

const handlePeerConnected = (peerId: PeerId): void => {
    // Cancel any pending cleanup from a prior disconnect.
    const existing = peerCleanupTimers.get(peerId);
    if (existing !== undefined) {
        clearTimeout(existing);
        peerCleanupTimers.delete(peerId);
    }

    automergeSync?.addPeer(peerId);

    peerManager?.sendCrdtSync({
        peerId,
        message: { type: 'peer-info', peer: getLocalPeerInfo() },
    });

    // Host auto-grants editor role so joiners can edit immediately.
    permissionManager?.grantRole(peerId, 'editor');

    updatePeerConnectionState(peerId, true);

    const state = collaborationStore.value;
    if (state) {
        collaborationStore.set({ ...state, connectionStatus: 'connected' });
    }
};

const handlePeerDisconnected = (peerId: PeerId): void => {
    automergeSync?.removePeer(peerId);
    updatePeerConnectionState(peerId, false);

    // Schedule removal in case the peer never sends peer-leave (tab crash, etc.).
    const timer = setTimeout(() => {
        peerCleanupTimers.delete(peerId);
        removePeer(peerId);
    }, PEER_CLEANUP_DELAY_MS);
    peerCleanupTimers.set(peerId, timer);

    const state = collaborationStore.value;
    if (state) {
        const anyConnected = state.peers.some((p) => p.isConnected && p.id !== peerId);
        if (!anyConnected && state.peers.length > 0) {
            collaborationStore.set({ ...state, connectionStatus: 'disconnected' });
        }
    }
};

const addOrUpdatePeer = (peer: PeerInfo): void => {
    const state = collaborationStore.value;
    if (!state) {
        return;
    }
    const existing = state.peers.findIndex((p) => p.id === peer.id);
    if (existing >= 0) {
        const peers = [...state.peers];
        peers[existing] = { ...peer, isConnected: true, lastSeen: Date.now() };
        collaborationStore.set({ ...state, peers });
    } else {
        collaborationStore.set({ ...state, peers: [...state.peers, { ...peer, isConnected: true, lastSeen: Date.now() }] });
    }
};

const removePeer = (peerId: PeerId): void => {
    const state = collaborationStore.value;
    if (!state) {
        return;
    }
    collaborationStore.set({
        ...state,
        peers: state.peers.filter((p) => p.id !== peerId),
    });
    peerManager?.removePeer(peerId);
};

const updatePeerLastSeen = (peerId: PeerId): void => {
    const state = collaborationStore.value;
    if (!state) {
        return;
    }
    collaborationStore.set({
        ...state,
        peers: state.peers.map((p) =>
            p.id === peerId ? { ...p, lastSeen: Date.now() } : p
        ),
    });
};

const updatePeerConnectionState = (peerId: PeerId, isConnected: boolean): void => {
    const state = collaborationStore.value;
    if (!state) {
        return;
    }
    collaborationStore.set({
        ...state,
        peers: state.peers.map((p) =>
            p.id === peerId ? { ...p, isConnected, lastSeen: Date.now() } : p
        ),
    });
};

// -- Invite compression --
// Invites embed a full ICE-complete SDP, which can be several KB.
// Compressing with deflate-raw before base64 keeps QR codes scannable
// and makes copy-paste strings manageable.
// The 'z:' prefix lets joiners detect and decompress transparently,
// so old uncompressed invites continue to work during any transition.

async function compressInvite(json: string): Promise<string> {
    const bytes = new TextEncoder().encode(json);
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value!);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    const binary = Array.from(result, (b) => String.fromCharCode(b)).join('');
    return 'z:' + btoa(binary);
}

async function decompressInvite(raw: string): Promise<string> {
    if (!raw.startsWith('z:')) {
        // Legacy uncompressed invite: plain base64 JSON.
        return atob(raw);
    }
    const binary = atob(raw.slice(2));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    void writer.write(bytes);
    void writer.close();
    const chunks: Uint8Array[] = [];
    const reader = stream.readable.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value!);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return new TextDecoder().decode(result);
}

