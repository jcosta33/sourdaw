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

// -- Sender-controlled identity bounds --
//
// Peer id, name, and color strings arrive from remote senders on several
// ingress paths — presence broadcasts, `peer-info` messages, invite offers,
// and signaling answers — and are stored, keyed on, and rendered in the
// presence overlay and peer list. Every ingress must apply the same bounds; a
// path that stores a raw sender string verbatim lets a hostile peer inject
// unbounded payloads into store state and overlay rendering.

/** Max accepted length for a sender-supplied display name. */
export const MAX_PEER_NAME_LEN = 64;
/** Max accepted length for a sender-supplied color string. */
export const MAX_PEER_COLOR_LEN = 32;
/** Max accepted length for a sender-supplied peer id. */
export const MAX_PEER_ID_LEN = 64;

/** Fallback applied when a peer's color is not a well-formed CSS color. */
export const FALLBACK_PEER_COLOR = '#888888';

/**
 * Accept only the CSS color formats this app actually mints for peers — hex
 * (`#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`) and the functional `hsl()/hsla()/
 * rgb()/rgba()` forms (see {@link PEER_COLORS} and {@link peerColorForIndex}).
 * Anything else is rejected so a sender-supplied string can't break out of
 * the CSS gradient value it is interpolated into at PresenceMarker.tsx
 * (`repeating-linear-gradient(..., ${color}, ...)`).
 */
const SAFE_CSS_COLOR_RE =
    /^(#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(?:rgb|rgba|hsl|hsla)\([0-9.,%/\s]+\))$/;

/**
 * Truncate a sender-supplied display name to the shared bound.
 *
 * The cut is at UTF-16 code units, so it can land between the two halves of a
 * surrogate pair (an emoji, or anything outside the BMP). A trailing lone high
 * surrogate is dropped rather than stored: it is not well-formed UTF-16, and
 * it renders as U+FFFD in the peer list and the presence overlay.
 */
export function sanitizePeerName(name: string): string {
    if (name.length <= MAX_PEER_NAME_LEN) {
        return name;
    }
    const cut = name.slice(0, MAX_PEER_NAME_LEN);
    return /[\uD800-\uDBFF]$/.test(cut) ? cut.slice(0, -1) : cut;
}

/**
 * Whether a sender-supplied peer id is within the shared bound.
 *
 * Rejected rather than truncated, unlike the display fields: an id is an
 * identity key, not text. Cutting an over-length id would fold distinct
 * senders onto one key and let a hostile peer-info collide with — and
 * overwrite — an existing peer's record. A well-formed id is a UUID, far
 * inside this bound, so nothing legitimate is refused.
 */
export function isAcceptablePeerId(id: string): boolean {
    return id.length <= MAX_PEER_ID_LEN;
}

/**
 * Bound a sender-supplied color string and replace anything that is not a
 * well-formed CSS color with a neutral fallback.
 */
export function sanitizePeerColor(color: string): string {
    const bounded = color.length <= MAX_PEER_COLOR_LEN ? color : color.slice(0, MAX_PEER_COLOR_LEN);
    return SAFE_CSS_COLOR_RE.test(bounded) ? bounded : FALLBACK_PEER_COLOR;
}

// -- Sender-controlled asset-manifest bounds --
//
// An asset manifest arrives from a remote peer and declares the dimensions
// every later chunk is validated against, so the manifest itself decides how
// much receiver memory a transfer may claim. Each accepted chunk costs a `Map`
// entry plus a `Set` entry on top of its bytes, so the *slot count* matters
// independently of the byte ceiling: a manifest is only safe once both the
// per-chunk size and the total size are bounded from both ends.

/** Chunk size this peer sends with (256 KiB). Must sit inside the accepted range. */
export const ASSET_CHUNK_SIZE = 256 * 1024;

/** Hard ceiling on a single accepted asset transfer (512 MiB). */
export const MAX_ASSET_SIZE = 512 * 1024 * 1024;

/**
 * Floor on a manifest's declared chunk size (4 KiB).
 *
 * Without a floor, `chunkCount === ceil(size / chunkSize)` still admits a
 * `chunkSize: 1` manifest, which declares one slot per byte — up to ~5×10⁸
 * `Map` + `Set` entries for a size that is nominally within the byte ceiling.
 * The floor caps the worst-case slot count at `MAX_ASSET_SIZE /
 * MIN_ASSET_CHUNK_SIZE`, four orders of magnitude below that. No legitimate
 * sender is refused: every manifest this app mints declares
 * {@link ASSET_CHUNK_SIZE}.
 */
export const MIN_ASSET_CHUNK_SIZE = 4 * 1024;

/**
 * Ceiling on a manifest's declared chunk size (4 MiB).
 *
 * The declared chunk size is the per-chunk acceptance bound, so it also fixes
 * how large a single decoded chunk may be before it is refused. Allowing it to
 * reach `MAX_ASSET_SIZE` let one message claim the entire byte ceiling.
 */
export const MAX_ASSET_CHUNK_SIZE = 4 * 1024 * 1024;

/** Max accepted length for a sender-supplied asset file name. */
export const MAX_ASSET_NAME_LEN = 256;

/** Max accepted length for a sender-supplied asset MIME type. */
export const MAX_ASSET_MIME_LEN = 128;
