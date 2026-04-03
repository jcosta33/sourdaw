import {
    type PeerId,
    type PeerInfo,
    type PeerMessage,
    type PresenceData,
    type SignalingMessage,
    PEER_COLORS,
} from '../../models/CollaborationTypes';
import { startPlayback } from '#/modules/Transport/useCases/transportControls/startPlayback';
import { stopPlayback } from '#/modules/Transport/useCases/transportControls/stopPlayback';
import { seekPlayhead } from '#/modules/Transport/useCases/transportControls/seekPlayhead';
import { updateTransportState } from '#/modules/Transport/useCases/transportQueries';

import { setupProjectionBridge } from '#/modules/CrdtDocument/useCases/projection/projectProjection';

import { collaborationStore } from '../../stores/collaborationStore';
import { PeerConnectionManager } from '../../repositories/peerConnection';
import { AutomergeSync } from '../automergeSync';
import { TransportSync } from '../transportSync';
import { AssetTransfer } from '../assetTransfer';
import { PermissionManager } from '../permissions';

let peerManager: PeerConnectionManager | null = null;
let automergeSync: AutomergeSync | null = null;
let transportSync: TransportSync | null = null;
let assetTransfer: AssetTransfer | null = null;
let permissionManager: PermissionManager | null = null;
let cleanupProjectionBridge: (() => void) | null = null;
let presenceListeners = new Set<(data: PresenceData) => void>();
/** Tracks the host-assigned peer slot ID for the in-flight invite, if any. */
let pendingInviteId: PeerId | null = null;

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
        onIceCandidate: handleIceCandidate,
    });

    automergeSync = new AutomergeSync(peerManager);
    automergeSync.start();
    cleanupProjectionBridge = setupProjectionBridge();

    transportSync = new TransportSync(peerManager, {
        onPlay: (positionBeats, delayMs) => {
            updateTransportState({ playheadPosition: positionBeats });
            setTimeout(() => startPlayback(), delayMs);
        },
        onStop: (positionBeats) => {
            updateTransportState({ playheadPosition: positionBeats });
            stopPlayback();
        },
        onSeek: (positionBeats) => {
            seekPlayhead(positionBeats);
        },
    });
    transportSync.start();

    assetTransfer = new AssetTransfer(peerManager, {
        onAssetAvailable: (_hash) => {
            // Asset is now available in the local content store.
            // Clips referencing this hash can resolve their audio buffers.
        },
        onProgress: (_hash, _received, _total) => {
            // Could update a UI progress indicator.
        },
    });

    permissionManager = new PermissionManager(peerManager);

    collaborationStore.set({
        isEnabled: true,
        sessionId,
        localPeerId: peerId,
        localName: name,
        localColor: color,
        isHost: true,
        approvalRequired: false,
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
        onIceCandidate: handleIceCandidate,
    });

    automergeSync = new AutomergeSync(peerManager);
    automergeSync.start();
    cleanupProjectionBridge = setupProjectionBridge();

    transportSync = new TransportSync(peerManager, {
        onPlay: (positionBeats, delayMs) => {
            updateTransportState({ playheadPosition: positionBeats });
            setTimeout(() => startPlayback(), delayMs);
        },
        onStop: (positionBeats) => {
            updateTransportState({ playheadPosition: positionBeats });
            stopPlayback();
        },
        onSeek: (positionBeats) => {
            seekPlayhead(positionBeats);
        },
    });
    transportSync.start();

    assetTransfer = new AssetTransfer(peerManager, {
        onAssetAvailable: (_hash) => {},
        onProgress: (_hash, _received, _total) => {},
    });

    permissionManager = new PermissionManager(peerManager);

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
        approvalRequired: false,
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
    if (automergeSync) {
        automergeSync.stop();
        automergeSync = null;
    }
    if (cleanupProjectionBridge) {
        cleanupProjectionBridge();
        cleanupProjectionBridge = null;
    }
    if (transportSync) {
        transportSync.stop();
        transportSync = null;
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
        approvalRequired: false,
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

/** Get the transport sync instance (for wiring play/stop/seek). */
export const getTransportSync = (): TransportSync | null => transportSync;

/** Get the asset transfer instance (for requesting/providing assets). */
export const getAssetTransfer = (): AssetTransfer | null => assetTransfer;

/** Get the permission manager instance (for role checks). */
export const getPermissionManager = (): PermissionManager | null => permissionManager;

// -- Internal handlers --

const handlePeerMessage = (peerId: PeerId, message: PeerMessage): void => {
    if (message.type === 'crdt-sync') {
        // Route by docId to the appropriate subsystem
        if (message.docId === '__transport__') {
            transportSync?.handleMessage(peerId, message);
        } else if (message.docId === '__asset__') {
            void assetTransfer?.handleMessage(peerId, message);
        } else if (message.docId === '__permissions__') {
            permissionManager?.handleMessage(peerId, message);
        } else {
            automergeSync?.handlePeerMessage(peerId, message);
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
    automergeSync?.addPeer(peerId);

    peerManager?.sendCrdtSync(peerId, {
        type: 'peer-info',
        peer: getLocalPeerInfo(),
    });

    updatePeerConnectionState(peerId, true);

    const state = collaborationStore.value;
    if (state) {
        collaborationStore.set({ ...state, connectionStatus: 'connected' });
    }
};

const handlePeerDisconnected = (peerId: PeerId): void => {
    automergeSync?.removePeer(peerId);
    updatePeerConnectionState(peerId, false);

    // If the disconnected peer was the transport leader, elect a new one.
    if (transportSync && transportSync.getLeaderId() === peerId) {
        transportSync.electNewLeader();
    }

    const state = collaborationStore.value;
    if (state) {
        const anyConnected = state.peers.some((p) => p.isConnected && p.id !== peerId);
        if (!anyConnected && state.peers.length > 0) {
            collaborationStore.set({ ...state, connectionStatus: 'disconnected' });
        }
    }
};

const handleIceCandidate = (_peerId: PeerId, _candidate: string): void => {
    // In manual signaling mode, ICE candidates are gathered before the offer/answer
    // is copied. For trickle ICE (future), these would be exchanged separately.
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

