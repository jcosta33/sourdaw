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
    peers: PeerInfo[];
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    error: string | null;
};

/** Presence data broadcast ephemerally — NOT persisted in CRDT. */
export type PresenceData = {
    peerId: PeerId;
    name: string;
    color: string;
    cursorBeat: number | null;
    cursorTrackId: string | null;
    /** Current playhead position in beats — used to render ghost playheads. */
    playheadBeat: number | null;
};

/**
 * A partial presence broadcast. Identity fields are always present; every
 * other field is optional so a sender can emit a *delta* (e.g. a cursor-only
 * update, or a playhead-only heartbeat) without nulling fields owned by the
 * other broadcast path. The receiver merges deltas onto a per-peer record,
 * so omitted fields preserve their prior value. This prevents the presence
 * flicker that full overwrites caused (one path nulling the other's fields).
 */
export type PresenceDelta = Pick<PresenceData, 'peerId' | 'name' | 'color'> &
    Partial<Omit<PresenceData, 'peerId' | 'name' | 'color'>>;

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
    | { type: 'presence'; data: PresenceDelta }
    | { type: 'peer-info'; peer: PeerInfo }
    | { type: 'peer-leave'; peerId: PeerId };

/** Peer colors for the first 8 collaborators (host is always the first). */
export const PEER_COLORS = [
    '#3b82f6', // blue
    '#ef4444', // red
    '#22c55e', // green
    '#f59e0b', // amber
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
] as const;

/**
 * Deterministically derive a distinct color for a peer slot beyond the
 * curated {@link PEER_COLORS} palette. Spreads hues around the wheel via the
 * golden-angle (~137.5°) so consecutive overflow peers stay visually distinct
 * instead of all collapsing onto the host's blue (the previous fallback).
 */
export function peerColorForIndex(index: number): string {
    if (index < PEER_COLORS.length) {
        return PEER_COLORS[index]!;
    }
    const overflow = index - PEER_COLORS.length;
    const hue = Math.round((overflow * 137.508) % 360);
    return `hsl(${hue}, 70%, 55%)`;
}
