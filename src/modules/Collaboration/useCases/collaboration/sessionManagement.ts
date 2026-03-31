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

const generatePeerId = (): PeerId => crypto.randomUUID();
const generateSessionId = (): string => crypto.randomUUID().slice(0, 8);

const assignPeerColor = (index: number): string => {
    return PEER_COLORS[index % PEER_COLORS.length]!;
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
    const color = assignPeerColor(0);

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
        pendingJoinRequests: [],
        peers: [],
        connectionStatus: 'connected',
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

    const joinerPeerId = generatePeerId();
    const peer = peerManager.createPeer(joinerPeerId);
    const sdp = await peer.createOffer();

    const state = collaborationStore.value!;
    const invite: SignalingMessage = {
        type: 'offer',
        peerId: state.localPeerId!,
        name: state.localName,
        sessionId: state.sessionId!,
        sdp,
    };

    return btoa(JSON.stringify(invite));
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
        invite = JSON.parse(atob(inviteString.trim())) as SignalingMessage;
    } catch {
        throw new Error('Invalid invite — must be a valid invite string');
    }

    if (invite.type !== 'offer') {
        throw new Error('Invalid invite: expected offer');
    }

    const peerId = generatePeerId();
    const color = assignPeerColor(1);

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
            color: assignPeerColor(0),
            isHost: true,
            isConnected: false,
            lastSeen: Date.now(),
            latencyMs: null,
        }],
        approvalRequired: false,
        pendingJoinRequests: [],
        connectionStatus: 'connecting',
        error: null,
    });

    const answer: SignalingMessage = {
        type: 'answer',
        peerId,
        name,
        sdp: answerSdp,
    };

    return btoa(JSON.stringify(answer));
};

/**
 * Accept an answer from a joiner (host side, completes the connection).
 */
export const acceptAnswer = async (answerString: string): Promise<void> => {
    const answer = JSON.parse(atob(answerString)) as SignalingMessage;
    if (answer.type !== 'answer') {
        throw new Error('Invalid answer');
    }

    if (!peerManager) {
        throw new Error('No active session');
    }

    // In the v1 manual flow, there's one pending peer at a time.
    // Find the first non-connected peer and apply the answer.
    const allPeerIds = peerManager.getAllPeerIds();
    for (const id of allPeerIds) {
        const peer = peerManager.getPeer(id);
        if (peer && !peer.isReady()) {
            await peer.acceptAnswer(answer.sdp);

            // Add the joiner to our peer list
            const state = collaborationStore.value;
            if (state) {
                const joinerInfo: PeerInfo = {
                    id: answer.peerId,
                    name: answer.name,
                    color: assignPeerColor(state.peers.length + 1),
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
            return;
        }
    }

    throw new Error('No pending peer connection to accept answer for');
};

/** Tear down all subsystems without changing store state. */
const cleanupSubsystems = (): void => {
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
        pendingJoinRequests: [],
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

