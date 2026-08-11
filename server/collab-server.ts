import { timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { WebSocketServer, WebSocket, type RawData, type VerifyClientCallbackAsync } from 'ws';

type Peer = {
    ws: WebSocket;
    peerId: string;
    sessionId: string;
    name: string;
    isHost: boolean;
};

type Session = {
    id: string;
    peers: Map<string, Peer>;
    hostId: string;
};

type ClientMessage =
    | { type: 'join'; peerId: string; sessionId: string; name: string }
    | { type: 'leave'; peerId: string; sessionId: string }
    | { type: 'action'; peerId: string; sessionId: string; action: unknown; timestamp: number }
    | { type: 'cursor'; peerId: string; sessionId: string; cursor: { trackId: string; beat: number } }
    | { type: 'sync-request'; peerId: string; sessionId: string }
    | { type: 'sync-response'; peerId: string; sessionId: string; targetPeerId: string; state: unknown }
    | { type: 'state-update'; peerId: string; sessionId: string; state: unknown };

type ServerMessage =
    | {
          type: 'joined';
          peerId: string;
          sessionId: string;
          isHost: boolean;
          peers: Array<{ id: string; name: string; isHost: boolean }>;
      }
    | { type: 'peer-joined'; peerId: string; name: string; isHost: boolean }
    | { type: 'peer-left'; peerId: string; newHostId: string | null }
    | { type: 'action'; peerId: string; action: unknown; timestamp: number }
    | { type: 'cursor'; peerId: string; cursor: { trackId: string; beat: number } }
    | { type: 'sync-request'; peerId: string }
    | { type: 'sync-response'; peerId: string; state: unknown }
    | { type: 'state-update'; peerId: string; state: unknown }
    | { type: 'error'; message: string };

type JsonObject = { [key: string]: unknown };

const sessions = new Map<string, Session>();
const peerToSession = new Map<WebSocket, Peer>();
const socketLiveness = new Map<WebSocket, boolean>();
const socketRateLimits = new Map<WebSocket, { byteTokens: number; messageTokens: number; updatedAt: number }>();
const socketSources = new Map<WebSocket, string>();
const sourceConnectionCounts = new Map<string, number>();

function readIntegerEnv(input: { name: string; fallback: number; min: number; max: number }): number {
    const rawValue = process.env[input.name];
    if (rawValue === undefined) {
        return input.fallback;
    }

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < input.min || value > input.max) {
        console.error(`Invalid ${input.name}: expected an integer from ${input.min} to ${input.max}`);
        process.exit(1);
    }

    return value;
}

function readAuthToken(): string {
    const token = process.env.COLLAB_AUTH_TOKEN;
    if (token === undefined || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) {
        console.error('Invalid COLLAB_AUTH_TOKEN: expected 32-128 base64url characters');
        process.exit(1);
    }

    return token;
}

const AUTH_TOKEN = readAuthToken();
const HOST = process.env.COLLAB_HOST?.trim() || '127.0.0.1';
const PORT = readIntegerEnv({ name: 'PORT', fallback: 8787, min: 1, max: 65_535 });
const HEARTBEAT_MS = readIntegerEnv({ name: 'COLLAB_HEARTBEAT_MS', fallback: 30_000, min: 10, max: 300_000 });
const MAX_PAYLOAD_BYTES = readIntegerEnv({
    name: 'COLLAB_MAX_PAYLOAD_BYTES',
    fallback: 16 * 1024 * 1024,
    min: 1024,
    max: 64 * 1024 * 1024,
});
const MAX_CONNECTIONS = readIntegerEnv({ name: 'COLLAB_MAX_CONNECTIONS', fallback: 1024, min: 1, max: 100_000 });
const MAX_SOURCE_CONNECTIONS = readIntegerEnv({
    name: 'COLLAB_MAX_SOURCE_CONNECTIONS',
    fallback: 16,
    min: 1,
    max: 10_000,
});
const MAX_SESSIONS = readIntegerEnv({ name: 'COLLAB_MAX_SESSIONS', fallback: 512, min: 1, max: 100_000 });
const MAX_PEERS_PER_SESSION = readIntegerEnv({
    name: 'COLLAB_MAX_PEERS_PER_SESSION',
    fallback: 32,
    min: 1,
    max: 10_000,
});
const RATE_LIMIT_PER_SECOND = readIntegerEnv({
    name: 'COLLAB_RATE_LIMIT_PER_SECOND',
    fallback: 120,
    min: 1,
    max: 10_000,
});
const RATE_LIMIT_BYTES_PER_SECOND = readIntegerEnv({
    name: 'COLLAB_RATE_LIMIT_BYTES_PER_SECOND',
    fallback: 32 * 1024 * 1024,
    min: 1,
    max: 256 * 1024 * 1024,
});

function isAuthorized(protocolHeader: string | string[] | undefined): boolean {
    if (typeof protocolHeader !== 'string') {
        return false;
    }

    const protocols = protocolHeader.split(',').map((value) => value.trim());
    if (protocols.length !== 2 || protocols[0] !== 'sourdaw') {
        return false;
    }

    const providedToken = protocols[1];
    const expected = Buffer.from(AUTH_TOKEN);
    const provided = Buffer.from(providedToken);
    return expected.length === provided.length && timingSafeEqual(expected, provided);
}

const verifyClient: VerifyClientCallbackAsync = ({ req }, done) => {
    const source = req.socket.remoteAddress ?? 'unknown';
    if (!isAuthorized(req.headers['sec-websocket-protocol'])) {
        done(false, 401, 'Unauthorized');
        return;
    }

    if (!canAcceptConnection(source)) {
        done(false, 503, 'Capacity exceeded');
        return;
    }

    done(true);
};

function selectProtocol(protocols: Set<string>): string | false {
    return protocols.has('sourdaw') ? 'sourdaw' : false;
}

function exceedsMessageRate(ws: WebSocket, byteLength: number): boolean {
    const now = performance.now();
    const rate = socketRateLimits.get(ws);
    if (!rate) {
        return true;
    }

    const elapsedMs = Math.max(0, now - rate.updatedAt);
    rate.messageTokens = Math.min(
        RATE_LIMIT_PER_SECOND,
        rate.messageTokens + (elapsedMs * RATE_LIMIT_PER_SECOND) / 1_000
    );
    rate.byteTokens = Math.min(
        RATE_LIMIT_BYTES_PER_SECOND,
        rate.byteTokens + (elapsedMs * RATE_LIMIT_BYTES_PER_SECOND) / 1_000
    );
    rate.updatedAt = now;

    if (rate.messageTokens < 1 || rate.byteTokens < byteLength) {
        return true;
    }

    rate.messageTokens -= 1;
    rate.byteTokens -= byteLength;
    return false;
}

function canAcceptConnection(source: string): boolean {
    return socketSources.size < MAX_CONNECTIONS && (sourceConnectionCounts.get(source) ?? 0) < MAX_SOURCE_CONNECTIONS;
}

function is_json_object(value: unknown): value is JsonObject {
    if (typeof value !== 'object') {
        return false;
    }

    if (value === null) {
        return false;
    }

    if (Array.isArray(value)) {
        return false;
    }

    return true;
}

function has_field(input: { object_value: JsonObject; key: string }): boolean {
    return Object.prototype.hasOwnProperty.call(input.object_value, input.key);
}

function get_string_field(input: { object_value: JsonObject; key: string }): string | null {
    const value = input.object_value[input.key];
    if (typeof value !== 'string') {
        return null;
    }

    if (value.length === 0) {
        return null;
    }

    return value;
}

function get_number_field(input: { object_value: JsonObject; key: string }): number | null {
    const value = input.object_value[input.key];
    if (typeof value !== 'number') {
        return null;
    }

    if (!Number.isFinite(value)) {
        return null;
    }

    return value;
}

type GetPeerFieldsOutput = { peerId: string; sessionId: string } | null;

function get_peer_fields(object_value: JsonObject): GetPeerFieldsOutput {
    const peerId = get_string_field({ object_value, key: 'peerId' });
    if (peerId === null) {
        return null;
    }

    const sessionId = get_string_field({ object_value, key: 'sessionId' });
    if (sessionId === null) {
        return null;
    }

    return { peerId, sessionId };
}

type ParseCursorOutput = { trackId: string; beat: number } | null;

function parse_cursor(value: unknown): ParseCursorOutput {
    if (!is_json_object(value)) {
        return null;
    }

    const trackId = get_string_field({ object_value: value, key: 'trackId' });
    if (trackId === null) {
        return null;
    }

    const beat = get_number_field({ object_value: value, key: 'beat' });
    if (beat === null) {
        return null;
    }

    return { trackId, beat };
}

type ParseClientMessageOutput = ClientMessage | null;

function parse_client_message(value: unknown): ParseClientMessageOutput {
    if (!is_json_object(value)) {
        return null;
    }

    const type = get_string_field({ object_value: value, key: 'type' });
    if (type === null) {
        return null;
    }

    const peer_fields = get_peer_fields(value);
    if (peer_fields === null) {
        return null;
    }

    if (type === 'join') {
        const name = get_string_field({ object_value: value, key: 'name' });
        if (name === null) {
            return null;
        }

        return { type, peerId: peer_fields.peerId, sessionId: peer_fields.sessionId, name };
    }

    if (type === 'leave') {
        return { type, peerId: peer_fields.peerId, sessionId: peer_fields.sessionId };
    }

    if (type === 'action') {
        const timestamp = get_number_field({ object_value: value, key: 'timestamp' });
        if (timestamp === null) {
            return null;
        }

        if (!has_field({ object_value: value, key: 'action' })) {
            return null;
        }

        return {
            type,
            peerId: peer_fields.peerId,
            sessionId: peer_fields.sessionId,
            action: value.action,
            timestamp,
        };
    }

    if (type === 'cursor') {
        const cursor = parse_cursor(value.cursor);
        if (cursor === null) {
            return null;
        }

        return { type, peerId: peer_fields.peerId, sessionId: peer_fields.sessionId, cursor };
    }

    if (type === 'sync-request') {
        return { type, peerId: peer_fields.peerId, sessionId: peer_fields.sessionId };
    }

    if (type === 'sync-response') {
        const targetPeerId = get_string_field({ object_value: value, key: 'targetPeerId' });
        if (targetPeerId === null) {
            return null;
        }

        if (!has_field({ object_value: value, key: 'state' })) {
            return null;
        }

        return {
            type,
            peerId: peer_fields.peerId,
            sessionId: peer_fields.sessionId,
            targetPeerId,
            state: value.state,
        };
    }

    if (type === 'state-update') {
        if (!has_field({ object_value: value, key: 'state' })) {
            return null;
        }

        return {
            type,
            peerId: peer_fields.peerId,
            sessionId: peer_fields.sessionId,
            state: value.state,
        };
    }

    return null;
}

type GetVerifiedSessionInput = {
    ws: WebSocket;
    msg: Exclude<ClientMessage, { type: 'join' }>;
};

type GetVerifiedSessionOutput = Session | null;

function get_verified_session(input: GetVerifiedSessionInput): GetVerifiedSessionOutput {
    const peer = peerToSession.get(input.ws);
    if (!peer) {
        sendTo(input.ws, { type: 'error', message: 'Peer not joined' });
        return null;
    }

    if (peer.peerId !== input.msg.peerId || peer.sessionId !== input.msg.sessionId) {
        sendTo(input.ws, { type: 'error', message: 'Peer/session mismatch' });
        return null;
    }

    const session = sessions.get(input.msg.sessionId);
    if (!session) {
        sendTo(input.ws, { type: 'error', message: 'Session not found' });
        return null;
    }

    if (session.peers.get(input.msg.peerId)?.ws !== input.ws) {
        sendTo(input.ws, { type: 'error', message: 'Peer not in session' });
        return null;
    }

    return session;
}

function sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

function rawDataToString(data: RawData): string {
    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString();
    }

    if (Array.isArray(data)) {
        return Buffer.concat(data).toString();
    }

    return data.toString();
}

function rawDataByteLength(data: RawData): number {
    if (data instanceof ArrayBuffer) {
        return data.byteLength;
    }

    if (Array.isArray(data)) {
        return data.reduce((total, chunk) => total + chunk.byteLength, 0);
    }

    return data.byteLength;
}

function broadcastToOthers(session: Session, senderPeerId: string, msg: ServerMessage): void {
    for (const [id, peer] of session.peers) {
        if (id !== senderPeerId) {
            sendTo(peer.ws, msg);
        }
    }
}

function getPeerList(session: Session): Array<{ id: string; name: string; isHost: boolean }> {
    return Array.from(session.peers.values()).map((p) => ({
        id: p.peerId,
        name: p.name,
        isHost: p.isHost,
    }));
}

function handleJoin(ws: WebSocket, msg: Extract<ClientMessage, { type: 'join' }>): void {
    if (peerToSession.has(ws)) {
        sendTo(ws, { type: 'error', message: 'Peer already joined' });
        return;
    }

    let session = sessions.get(msg.sessionId);
    if (session?.peers.has(msg.peerId)) {
        sendTo(ws, { type: 'error', message: 'Peer ID already in use' });
        return;
    }

    if (!session && sessions.size >= MAX_SESSIONS) {
        sendTo(ws, { type: 'error', message: 'Session limit reached' });
        return;
    }

    if (session && session.peers.size >= MAX_PEERS_PER_SESSION) {
        sendTo(ws, { type: 'error', message: 'Session is full' });
        return;
    }

    const isHost = !session;

    if (!session) {
        session = { id: msg.sessionId, peers: new Map(), hostId: msg.peerId };
        sessions.set(msg.sessionId, session);
        console.log(`Session created: ${msg.sessionId}`);
    }

    const peer: Peer = {
        ws,
        peerId: msg.peerId,
        sessionId: msg.sessionId,
        name: msg.name,
        isHost,
    };

    session.peers.set(msg.peerId, peer);
    peerToSession.set(ws, peer);

    sendTo(ws, {
        type: 'joined',
        peerId: msg.peerId,
        sessionId: msg.sessionId,
        isHost,
        peers: getPeerList(session),
    });

    broadcastToOthers(session, msg.peerId, {
        type: 'peer-joined',
        peerId: msg.peerId,
        name: msg.name,
        isHost,
    });

    console.log(`Peer ${msg.name} (${msg.peerId}) joined session ${msg.sessionId} (${session.peers.size} peers)`);
}

function handleLeave(ws: WebSocket, peerId: string, sessionId: string): void {
    peerToSession.delete(ws);
    const session = sessions.get(sessionId);
    if (!session) {
        return;
    }

    if (session.peers.get(peerId)?.ws !== ws) {
        return;
    }

    session.peers.delete(peerId);

    if (session.peers.size === 0) {
        sessions.delete(sessionId);
        console.log(`Session destroyed: ${sessionId}`);
        return;
    }

    let newHostId: string | null = null;
    if (session.hostId === peerId) {
        const nextPeer = session.peers.values().next().value;
        if (nextPeer) {
            nextPeer.isHost = true;
            session.hostId = nextPeer.peerId;
            newHostId = nextPeer.peerId;
            console.log(`Host transferred to ${nextPeer.name} (${nextPeer.peerId})`);
        }
    }

    broadcastToOthers(session, peerId, {
        type: 'peer-left',
        peerId,
        newHostId,
    });

    console.log(`Peer ${peerId} left session ${sessionId} (${session.peers.size} peers remaining)`);
}

function handleAction(session: Session, msg: Extract<ClientMessage, { type: 'action' }>): void {
    broadcastToOthers(session, msg.peerId, {
        type: 'action',
        peerId: msg.peerId,
        action: msg.action,
        timestamp: msg.timestamp,
    });
}

function handleCursor(session: Session, msg: Extract<ClientMessage, { type: 'cursor' }>): void {
    broadcastToOthers(session, msg.peerId, {
        type: 'cursor',
        peerId: msg.peerId,
        cursor: msg.cursor,
    });
}

function handleSyncRequest(session: Session, msg: Extract<ClientMessage, { type: 'sync-request' }>): void {
    const host = session.peers.get(session.hostId);
    if (!host || host.ws.readyState !== WebSocket.OPEN) {
        const requester = session.peers.get(msg.peerId);
        if (requester) {
            sendTo(requester.ws, { type: 'error', message: 'Session host unavailable' });
        }
        return;
    }

    sendTo(host.ws, { type: 'sync-request', peerId: msg.peerId });
}

function handleSyncResponse(session: Session, msg: Extract<ClientMessage, { type: 'sync-response' }>): void {
    if (msg.peerId !== session.hostId) {
        const sender = session.peers.get(msg.peerId);
        if (sender) {
            sendTo(sender.ws, { type: 'error', message: 'Only the host may send sync responses' });
        }
        return;
    }

    const target = session.peers.get(msg.targetPeerId);
    if (target) {
        sendTo(target.ws, { type: 'sync-response', peerId: msg.peerId, state: msg.state });
    }
}

function handleStateUpdate(session: Session, msg: Extract<ClientMessage, { type: 'state-update' }>): void {
    broadcastToOthers(session, msg.peerId, {
        type: 'state-update',
        peerId: msg.peerId,
        state: msg.state,
    });
}

function handleMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
        const parsed: unknown = JSON.parse(raw);
        const validated_msg = parse_client_message(parsed);
        if (validated_msg === null) {
            sendTo(ws, { type: 'error', message: 'Invalid message' });
            return;
        }

        msg = validated_msg;
    } catch {
        sendTo(ws, { type: 'error', message: 'Invalid JSON' });
        return;
    }

    if (msg.type === 'join') {
        handleJoin(ws, msg);
        return;
    }

    if (msg.type === 'leave') {
        if (get_verified_session({ ws, msg }) === null) {
            return;
        }

        handleLeave(ws, msg.peerId, msg.sessionId);
        return;
    }

    const session = get_verified_session({ ws, msg });
    if (session === null) {
        return;
    }

    switch (msg.type) {
        case 'action':
            handleAction(session, msg);
            break;
        case 'cursor':
            handleCursor(session, msg);
            break;
        case 'sync-request':
            handleSyncRequest(session, msg);
            break;
        case 'sync-response':
            handleSyncResponse(session, msg);
            break;
        case 'state-update':
            handleStateUpdate(session, msg);
            break;
    }
}

const wss = new WebSocketServer({
    handleProtocols: selectProtocol,
    host: HOST,
    maxPayload: MAX_PAYLOAD_BYTES,
    port: PORT,
    verifyClient,
});

function cleanupSocket(ws: WebSocket): void {
    socketLiveness.delete(ws);
    socketRateLimits.delete(ws);

    const source = socketSources.get(ws);
    if (source) {
        socketSources.delete(ws);
        const remaining = (sourceConnectionCounts.get(source) ?? 1) - 1;
        if (remaining === 0) {
            sourceConnectionCounts.delete(source);
        } else {
            sourceConnectionCounts.set(source, remaining);
        }
    }

    const peer = peerToSession.get(ws);
    if (peer) {
        handleLeave(ws, peer.peerId, peer.sessionId);
    }
}

wss.on('connection', (ws, request) => {
    const source = request.socket.remoteAddress ?? 'unknown';
    socketSources.set(ws, source);
    sourceConnectionCounts.set(source, (sourceConnectionCounts.get(source) ?? 0) + 1);
    socketLiveness.set(ws, true);
    socketRateLimits.set(ws, {
        byteTokens: RATE_LIMIT_BYTES_PER_SECOND,
        messageTokens: RATE_LIMIT_PER_SECOND,
        updatedAt: performance.now(),
    });

    ws.on('pong', () => {
        socketLiveness.set(ws, true);
    });

    ws.on('message', (data) => {
        if (exceedsMessageRate(ws, rawDataByteLength(data))) {
            ws.close(1008, 'Message rate exceeded');
            return;
        }

        handleMessage(ws, rawDataToString(data));
    });

    ws.on('close', () => {
        cleanupSocket(ws);
    });

    ws.on('error', () => {
        cleanupSocket(ws);
    });
});

const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
        if (socketLiveness.get(ws) === false) {
            const peer = peerToSession.get(ws);
            if (peer) {
                handleLeave(ws, peer.peerId, peer.sessionId);
            }
            ws.terminate();
            continue;
        }

        socketLiveness.set(ws, false);
        ws.ping();
    }
}, HEARTBEAT_MS);

wss.on('close', () => {
    clearInterval(heartbeat);
});

wss.on('error', (error: NodeJS.ErrnoException) => {
    console.error(`Collaboration server failed to start: ${error.code ?? error.message}`);
    process.exit(1);
});

wss.on('listening', () => {
    console.log(`Sourdaw Collaboration Server running on ws://${HOST}:${PORT}`);
});
