import { WebSocketServer, WebSocket } from "ws";

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
    | { type: "join"; peerId: string; sessionId: string; name: string }
    | { type: "leave"; peerId: string; sessionId: string }
    | { type: "action"; peerId: string; sessionId: string; action: unknown; timestamp: number }
    | { type: "cursor"; peerId: string; sessionId: string; cursor: { trackId: string; beat: number } }
    | { type: "sync-request"; peerId: string; sessionId: string }
    | { type: "sync-response"; peerId: string; sessionId: string; targetPeerId: string; state: unknown }
    | { type: "state-update"; peerId: string; sessionId: string; state: unknown };

type ServerMessage =
    | { type: "joined"; peerId: string; sessionId: string; isHost: boolean; peers: Array<{ id: string; name: string; isHost: boolean }> }
    | { type: "peer-joined"; peerId: string; name: string; isHost: boolean }
    | { type: "peer-left"; peerId: string; newHostId: string | null }
    | { type: "action"; peerId: string; action: unknown; timestamp: number }
    | { type: "cursor"; peerId: string; cursor: { trackId: string; beat: number } }
    | { type: "sync-request"; peerId: string }
    | { type: "sync-response"; peerId: string; state: unknown }
    | { type: "state-update"; peerId: string; state: unknown }
    | { type: "error"; message: string };

const sessions = new Map<string, Session>();
const peerToSession = new Map<WebSocket, Peer>();

const PORT = parseInt(process.env.PORT ?? "8787", 10);

function sendTo(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
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

function handleJoin(ws: WebSocket, msg: Extract<ClientMessage, { type: "join" }>): void {
    let session = sessions.get(msg.sessionId);
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
        type: "joined",
        peerId: msg.peerId,
        sessionId: msg.sessionId,
        isHost,
        peers: getPeerList(session),
    });

    broadcastToOthers(session, msg.peerId, {
        type: "peer-joined",
        peerId: msg.peerId,
        name: msg.name,
        isHost,
    });

    console.log(`Peer ${msg.name} (${msg.peerId}) joined session ${msg.sessionId} (${session.peers.size} peers)`);
}

function handleLeave(ws: WebSocket, peerId: string, sessionId: string): void {
    const session = sessions.get(sessionId);
    if (!session) {
        return;
    }

    session.peers.delete(peerId);
    peerToSession.delete(ws);

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
        type: "peer-left",
        peerId,
        newHostId,
    });

    console.log(`Peer ${peerId} left session ${sessionId} (${session.peers.size} peers remaining)`);
}

function handleAction(session: Session, msg: Extract<ClientMessage, { type: "action" }>): void {
    broadcastToOthers(session, msg.peerId, {
        type: "action",
        peerId: msg.peerId,
        action: msg.action,
        timestamp: msg.timestamp,
    });
}

function handleCursor(session: Session, msg: Extract<ClientMessage, { type: "cursor" }>): void {
    broadcastToOthers(session, msg.peerId, {
        type: "cursor",
        peerId: msg.peerId,
        cursor: msg.cursor,
    });
}

function handleSyncRequest(session: Session, msg: Extract<ClientMessage, { type: "sync-request" }>): void {
    const host = session.peers.get(session.hostId);
    if (host) {
        sendTo(host.ws, { type: "sync-request", peerId: msg.peerId });
    }
}

function handleSyncResponse(session: Session, msg: Extract<ClientMessage, { type: "sync-response" }>): void {
    const target = session.peers.get(msg.targetPeerId);
    if (target) {
        sendTo(target.ws, { type: "sync-response", peerId: msg.peerId, state: msg.state });
    }
}

function handleStateUpdate(session: Session, msg: Extract<ClientMessage, { type: "state-update" }>): void {
    broadcastToOthers(session, msg.peerId, {
        type: "state-update",
        peerId: msg.peerId,
        state: msg.state,
    });
}

function handleMessage(ws: WebSocket, raw: string): void {
    let msg: ClientMessage;
    try {
        msg = JSON.parse(raw) as ClientMessage;
    } catch {
        sendTo(ws, { type: "error", message: "Invalid JSON" });
        return;
    }

    if (msg.type === "join") {
        handleJoin(ws, msg);
        return;
    }

    if (msg.type === "leave") {
        handleLeave(ws, msg.peerId, msg.sessionId);
        return;
    }

    const session = sessions.get(msg.sessionId);
    if (!session) {
        sendTo(ws, { type: "error", message: "Session not found" });
        return;
    }

    switch (msg.type) {
        case "action":
            handleAction(session, msg);
            break;
        case "cursor":
            handleCursor(session, msg);
            break;
        case "sync-request":
            handleSyncRequest(session, msg);
            break;
        case "sync-response":
            handleSyncResponse(session, msg);
            break;
        case "state-update":
            handleStateUpdate(session, msg);
            break;
    }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
    ws.on("message", (data) => {
        handleMessage(ws, data.toString());
    });

    ws.on("close", () => {
        const peer = peerToSession.get(ws);
        if (peer) {
            handleLeave(ws, peer.peerId, peer.sessionId);
        }
    });

    ws.on("error", () => {
        const peer = peerToSession.get(ws);
        if (peer) {
            handleLeave(ws, peer.peerId, peer.sessionId);
        }
    });
});

console.log(`WebDAW Collaboration Server running on ws://localhost:${PORT}`);
