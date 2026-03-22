import { type AppAction } from '#/modules/Command/useCases/commandQueries';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
import { type PeerInfo, type SyncMessage } from '../models/CollaborationTypes';
import { collaborationStore } from '../stores/collaborationStore';
import { appendLocalOperation, appendRemoteOperation, clearOperations } from './operationLog';
import * as transport from './webSocketTransport';

const PEER_COLORS = ['#4a7090', '#c45040', '#7db8a0', '#c4aa5f', '#a89bc4', '#c49090', '#7fb8c4', '#c9a07a'];

let colorIndex = 0;

function generatePeerColor(): string {
    const color = PEER_COLORS[colorIndex % PEER_COLORS.length]!;
    colorIndex++;
    return color;
}

const DEFAULT_WS_URL = 'ws://localhost:8787';

function getWsUrl(): string {
    return (import.meta.env.VITE_COLLAB_WS_URL as string | undefined) ?? DEFAULT_WS_URL;
}

function handleServerMessage(msg: SyncMessage): void {
    const state = collaborationStore.value;
    if (!state) {
        return;
    }

    switch (msg.type) {
        case 'action': {
            const entry = {
                id: `remote-${Date.now()}`,
                peerId: msg.peerId,
                action: msg.action,
                timestamp: msg.timestamp,
                vectorClock: {},
            };
            appendRemoteOperation(entry);
            void executeAppAction(entry.action);
            break;
        }
        case 'peer-join': {
            const exists = state.peers.some((p) => p.id === msg.peer.id);
            if (!exists) {
                collaborationStore.set({
                    ...state,
                    peers: [...state.peers, msg.peer],
                });
            }
            break;
        }
        case 'peer-leave': {
            collaborationStore.set({
                ...state,
                peers: state.peers.filter((p) => p.id !== msg.peerId),
            });
            break;
        }
        case 'cursor-update': {
            collaborationStore.set({
                ...state,
                peers: state.peers.map((p) => (p.id === msg.peerId ? { ...p, cursor: msg.cursor } : p)),
            });
            break;
        }
        default:
            break;
    }
}

type JoinedMessage = {
    type: 'joined';
    peerId: string;
    sessionId: string;
    isHost: boolean;
    peers: Array<{ id: string; name: string; isHost: boolean }>;
};

type PeerJoinedMessage = { type: 'peer-joined'; peerId: string; name: string; isHost: boolean };
type PeerLeftMessage = { type: 'peer-left'; peerId: string; newHostId: string | null };
type ActionMessage = { type: 'action'; peerId: string; action: AppAction; timestamp: number };
type CursorMessage = { type: 'cursor'; peerId: string; cursor: { trackId: string; beat: number } };

type ServerMessage =
    | JoinedMessage
    | PeerJoinedMessage
    | PeerLeftMessage
    | ActionMessage
    | CursorMessage
    | { type: 'error'; message: string };

function handleRawServerMessage(data: unknown): void {
    const msg = data as ServerMessage;

    const state = collaborationStore.value;
    if (!state) {
        return;
    }

    switch (msg.type) {
        case 'joined': {
            const remotePeers: PeerInfo[] = msg.peers
                .filter((p) => p.id !== msg.peerId)
                .map((p) => ({
                    id: p.id,
                    name: p.name,
                    color: generatePeerColor(),
                    isHost: p.isHost,
                    isConnected: true,
                    lastSeen: Date.now(),
                }));

            const localPeer = state.peers.find((p) => p.id === state.localPeerId);
            const allPeers = localPeer ? [{ ...localPeer, isHost: msg.isHost }, ...remotePeers] : remotePeers;

            collaborationStore.set({
                ...state,
                connectionStatus: 'connected',
                peers: allPeers,
            });
            break;
        }
        case 'peer-joined': {
            const newPeer: PeerInfo = {
                id: msg.peerId,
                name: msg.name,
                color: generatePeerColor(),
                isHost: msg.isHost,
                isConnected: true,
                lastSeen: Date.now(),
            };
            handleServerMessage({ type: 'peer-join', peer: newPeer });
            break;
        }
        case 'peer-left': {
            handleServerMessage({ type: 'peer-leave', peerId: msg.peerId });
            if (msg.newHostId && state.localPeerId === msg.newHostId) {
                const updated = collaborationStore.value;
                if (updated) {
                    collaborationStore.set({
                        ...updated,
                        peers: updated.peers.map((p) =>
                            p.id === msg.newHostId ? { ...p, isHost: true } : { ...p, isHost: false }
                        ),
                    });
                }
            }
            break;
        }
        case 'action': {
            handleServerMessage({
                type: 'action',
                peerId: msg.peerId,
                action: msg.action,
                timestamp: msg.timestamp,
            });
            break;
        }
        case 'cursor': {
            handleServerMessage({
                type: 'cursor-update',
                peerId: msg.peerId,
                cursor: msg.cursor,
            });
            break;
        }
        case 'error': {
            const errMsg = msg as { type: 'error'; message: string };
            collaborationStore.set({ ...state, connectionStatus: 'error', error: errMsg.message });
            break;
        }
        default:
            break;
    }
}

export function createSession(): string {
    const sessionId = crypto.randomUUID();
    const localPeerId = crypto.randomUUID();

    collaborationStore.set({
        isEnabled: true,
        sessionId,
        localPeerId,
        peers: [
            {
                id: localPeerId,
                name: 'You',
                color: '#4a7090',
                isHost: true,
                isConnected: true,
                lastSeen: Date.now(),
            },
        ],
        connectionStatus: 'connecting',
        error: null,
    });

    transport.connect(getWsUrl(), {
        onMessage: (raw) => handleRawServerMessage(raw as unknown),
        onConnect: () => {
            sendRaw({ type: 'join', peerId: localPeerId, sessionId, name: 'You' });
        },
        onDisconnect: () => {
            const s = collaborationStore.value;
            if (s?.isEnabled) {
                collaborationStore.set({ ...s, connectionStatus: 'disconnected' });
            }
        },
        onError: (error) => {
            const s = collaborationStore.value;
            if (s) {
                collaborationStore.set({ ...s, connectionStatus: 'error', error });
            }
        },
    });

    return sessionId;
}

export function joinSession(sessionId: string, peerName: string): void {
    const localPeerId = crypto.randomUUID();

    collaborationStore.set({
        isEnabled: true,
        sessionId,
        localPeerId,
        peers: [
            {
                id: localPeerId,
                name: peerName || 'Peer',
                color: generatePeerColor(),
                isHost: false,
                isConnected: true,
                lastSeen: Date.now(),
            },
        ],
        connectionStatus: 'connecting',
        error: null,
    });

    transport.connect(getWsUrl(), {
        onMessage: (raw) => handleRawServerMessage(raw as unknown),
        onConnect: () => {
            sendRaw({ type: 'join', peerId: localPeerId, sessionId, name: peerName || 'Peer' });
        },
        onDisconnect: () => {
            const s = collaborationStore.value;
            if (s?.isEnabled) {
                collaborationStore.set({ ...s, connectionStatus: 'disconnected' });
            }
        },
        onError: (error) => {
            const s = collaborationStore.value;
            if (s) {
                collaborationStore.set({ ...s, connectionStatus: 'error', error });
            }
        },
    });
}

export function leaveSession(): void {
    const state = collaborationStore.value;
    if (state?.localPeerId && state.sessionId) {
        sendRaw({ type: 'leave', peerId: state.localPeerId, sessionId: state.sessionId });
    }

    transport.disconnect();
    clearOperations();
    collaborationStore.set({
        isEnabled: false,
        sessionId: null,
        localPeerId: null,
        peers: [],
        connectionStatus: 'disconnected',
        error: null,
    });
}

export function broadcastAction(action: AppAction): void {
    const state = collaborationStore.value;
    if (!state?.isEnabled || !state.localPeerId || !state.sessionId) {
        return;
    }

    appendLocalOperation(state.localPeerId, action);
    sendRaw({
        type: 'action',
        peerId: state.localPeerId,
        sessionId: state.sessionId,
        action,
        timestamp: Date.now(),
    });
}

export function updateCursor(trackId: string, beat: number): void {
    const state = collaborationStore.value;
    if (!state?.isEnabled || !state.localPeerId || !state.sessionId) {
        return;
    }

    sendRaw({
        type: 'cursor',
        peerId: state.localPeerId,
        sessionId: state.sessionId,
        cursor: { trackId, beat },
    });
}

export const receiveRemoteAction = async (entry: {
    id: string;
    peerId: string;
    action: AppAction;
    timestamp: number;
    vectorClock: Record<string, number>;
}): Promise<void> => {
    appendRemoteOperation(entry);
    await executeAppAction(entry.action);
};

function sendRaw(msg: Record<string, unknown>): void {
    transport.send(msg as unknown as import('../models/CollaborationTypes').SyncMessage);
}
