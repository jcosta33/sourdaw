export type PeerId = string;

export type PeerInfo = {
    id: PeerId;
    name: string;
    color: string;
    isHost: boolean;
    isConnected: boolean;
    lastSeen: number;
    latencyMs: number | null;
};

export type CollaborationState = {
    isEnabled: boolean;
    sessionId: string | null;
    localPeerId: PeerId | null;
    localName: string;
    localColor: string;
    isHost: boolean;
    approvalRequired: boolean;
    peers: PeerInfo[];
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    error: string | null;
};

/** Presence data broadcast ephemerally — NOT persisted in CRDT. */
export type PresenceData = {
    peerId: PeerId;
    name: string;
    color: string;
    view: 'arrangement' | 'mixer' | 'piano-roll' | 'device';
    cursorBeat: number | null;
    cursorTrackId: string | null;
    selectedClipIds: string[];
    selectedNoteIds: string[];
    viewportStartBeat: number;
    viewportEndBeat: number;
    viewportTrackIds: string[];
    action: string | null;
};

/**
 * Messages sent over the signaling channel (manual exchange or WebSocket).
 * These are used to establish WebRTC connections, not for project data.
 */
export type SignalingMessage =
    | { type: 'offer'; peerId: PeerId; name: string; sessionId: string; sdp: string; pendingPeerId: PeerId }
    | { type: 'answer'; peerId: PeerId; name: string; sdp: string; pendingPeerId: PeerId };

/**
 * Messages sent over WebRTC data channels after connection is established.
 */
export type PeerMessage =
    | { type: 'crdt-sync'; docId: string; data: string }
    | { type: 'presence'; data: PresenceData }
    | { type: 'peer-info'; peer: PeerInfo }
    | { type: 'peer-leave'; peerId: PeerId };

/** Peer colors for up to 8 collaborators. */
export const PEER_COLORS = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#22c55e', // green
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
];
