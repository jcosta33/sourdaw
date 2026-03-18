import { type AppAction } from '#/modules/Command/useCases/commandQueries';

export type PeerId = string;

export type PeerInfo = {
    id: PeerId;
    name: string;
    color: string;
    isHost: boolean;
    isConnected: boolean;
    lastSeen: number;
    cursor?: { trackId: string; beat: number };
};

export type CollaborationState = {
    isEnabled: boolean;
    sessionId: string | null;
    localPeerId: PeerId | null;
    peers: PeerInfo[];
    connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
    error: string | null;
};

export type SyncMessage =
    | { type: 'action'; peerId: PeerId; action: AppAction; timestamp: number }
    | { type: 'state-request'; peerId: PeerId }
    | { type: 'state-response'; peerId: PeerId; state: unknown }
    | { type: 'peer-join'; peer: PeerInfo }
    | { type: 'peer-leave'; peerId: PeerId }
    | { type: 'cursor-update'; peerId: PeerId; cursor: { trackId: string; beat: number } }
    | { type: 'ack'; peerId: PeerId; messageId: string };

export type OperationEntry = {
    id: string;
    peerId: PeerId;
    action: AppAction;
    timestamp: number;
    vectorClock: Record<PeerId, number>;
};
