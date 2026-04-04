import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { collaborationStore } from '../stores/collaborationStore';
import { type PeerConnectionManager } from '../repositories/peerConnection';

/**
 * Transport synchronization with leader election.
 *
 * The transport leader controls play/stop/seek for all peers.
 * By default, the session host is the initial leader.
 * Leadership can be transferred or auto-elected on disconnect.
 */

export type TransportCommand =
    | { type: 'transport.play'; positionBeats: number; leaderTimeMs: number }
    | { type: 'transport.stop'; positionBeats: number }
    | { type: 'transport.seek'; positionBeats: number }
    | { type: 'transport.leader-change'; newLeaderId: PeerId; epoch: number };

export type ClockSyncMessage =
    | { type: 'clock.ping'; sendTime: number; seq: number }
    | { type: 'clock.pong'; sendTime: number; receiveTime: number; respondTime: number; seq: number };

type TransportSyncCallbacks = {
    onPlay: (positionBeats: number, delayMs: number) => void;
    onStop: (positionBeats: number) => void;
    onSeek: (positionBeats: number) => void;
};

export class TransportSync {
    private peerManager: PeerConnectionManager;
    private callbacks: TransportSyncCallbacks;
    private leaderId: PeerId | null = null;
    private leaderEpoch = 0;
    private clockOffsets = new Map<PeerId, number>();
    private rttEstimates = new Map<PeerId, number>();
    private pingSeq = 0;
    private pingInterval: ReturnType<typeof setInterval> | null = null;

    constructor(peerManager: PeerConnectionManager, callbacks: TransportSyncCallbacks) {
        this.peerManager = peerManager;
        this.callbacks = callbacks;
    }

    /** Start clock sync pings. */
    start(): void {
        const state = collaborationStore.value;
        if (state?.isHost) {
            this.leaderId = state.localPeerId;
        }

        this.pingInterval = setInterval(() => {
            if (this.peerManager.getConnectedPeerIds().length > 0) {
                this.sendClockPing();
            }
        }, 2000);
    }

    /** Stop clock sync. */
    stop(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
        this.clockOffsets.clear();
        this.rttEstimates.clear();
    }

    /** Check if the local peer is the transport leader. */
    isLeader(): boolean {
        const state = collaborationStore.value;
        return this.leaderId !== null && this.leaderId === state?.localPeerId;
    }

    /** Get the current leader ID. */
    getLeaderId(): PeerId | null {
        return this.leaderId;
    }

    /** Leader: broadcast play command. */
    play(positionBeats: number): void {
        if (!this.isLeader()) {
            return;
        }

        const cmd: TransportCommand = {
            type: 'transport.play',
            positionBeats,
            leaderTimeMs: performance.now(),
        };

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: '__transport__',
            data: JSON.stringify(cmd),
        });
    }

    /** Leader: broadcast stop command. */
    stopPlayback(positionBeats: number): void {
        if (!this.isLeader()) {
            return;
        }

        const cmd: TransportCommand = {
            type: 'transport.stop',
            positionBeats,
        };

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: '__transport__',
            data: JSON.stringify(cmd),
        });
    }

    /** Leader: broadcast seek command. */
    seek(positionBeats: number): void {
        if (!this.isLeader()) {
            return;
        }

        const cmd: TransportCommand = {
            type: 'transport.seek',
            positionBeats,
        };

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: '__transport__',
            data: JSON.stringify(cmd),
        });
    }

    /** Handle incoming transport messages. */
    handleMessage(peerId: PeerId, message: PeerMessage): void {
        if (message.type !== 'crdt-sync' || message.docId !== '__transport__') {
            return;
        }

        let data: TransportCommand | ClockSyncMessage;
        try {
            data = JSON.parse(message.data) as TransportCommand | ClockSyncMessage;
        } catch {
            return;
        }

        if (data.type === 'clock.ping') {
            this.handleClockPing(peerId, data);
            return;
        }
        if (data.type === 'clock.pong') {
            this.handleClockPong(peerId, data);
            return;
        }

        const cmd = data as TransportCommand;

        if (cmd.type === 'transport.play') {
            const offset = this.clockOffsets.get(peerId) ?? 0;
            const rtt = this.rttEstimates.get(peerId) ?? 0;
            const delayMs = Math.max(0, (cmd.leaderTimeMs + offset) - performance.now() + rtt / 2);
            this.callbacks.onPlay(cmd.positionBeats, delayMs);
        } else if (cmd.type === 'transport.stop') {
            this.callbacks.onStop(cmd.positionBeats);
        } else if (cmd.type === 'transport.seek') {
            this.callbacks.onSeek(cmd.positionBeats);
        } else if (cmd.type === 'transport.leader-change') {
            if (cmd.epoch > this.leaderEpoch) {
                this.leaderEpoch = cmd.epoch;
                this.leaderId = cmd.newLeaderId;
            }
        }
    }

    /** Elect a new leader when the current leader disconnects. */
    electNewLeader(): void {
        const state = collaborationStore.value;
        if (!state) {
            return;
        }

        const connectedPeerIds = [
            state.localPeerId,
            ...state.peers.filter((p) => p.isConnected).map((p) => p.id),
        ].filter(Boolean) as string[];

        // Host takes priority, otherwise lowest lexicographic ID
        const hostPeer = state.peers.find((p) => p.isHost && p.isConnected);
        if (hostPeer) {
            this.leaderId = hostPeer.id;
        } else if (state.isHost) {
            this.leaderId = state.localPeerId;
        } else {
            connectedPeerIds.sort();
            this.leaderId = connectedPeerIds[0] ?? state.localPeerId;
        }

        this.leaderEpoch++;
    }

    // -- Clock sync --

    private sendClockPing(): void {
        this.pingSeq++;
        const msg: ClockSyncMessage = {
            type: 'clock.ping',
            sendTime: performance.now(),
            seq: this.pingSeq,
        };

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: '__transport__',
            data: JSON.stringify(msg),
        });
    }

    private handleClockPing(peerId: PeerId, msg: ClockSyncMessage): void {
        if (msg.type !== 'clock.ping') {
            return;
        }

        const now = performance.now();
        const pong: ClockSyncMessage = {
            type: 'clock.pong',
            sendTime: msg.sendTime,
            receiveTime: now,
            respondTime: now,
            seq: msg.seq,
        };

        this.peerManager.sendCrdtSync(peerId, {
            type: 'crdt-sync',
            docId: '__transport__',
            data: JSON.stringify(pong),
        });
    }

    private handleClockPong(_peerId: PeerId, msg: ClockSyncMessage): void {
        if (msg.type !== 'clock.pong') {
            return;
        }

        const now = performance.now();
        const rtt = now - msg.sendTime;
        const oneWayDelay = rtt / 2;
        const offset = msg.receiveTime - msg.sendTime - oneWayDelay;

        // Exponential moving average for smoothed estimates
        const alpha = 0.3;
        const prevRtt = this.rttEstimates.get(_peerId) ?? rtt;
        const prevOffset = this.clockOffsets.get(_peerId) ?? offset;

        this.rttEstimates.set(_peerId, prevRtt * (1 - alpha) + rtt * alpha);
        this.clockOffsets.set(_peerId, prevOffset * (1 - alpha) + offset * alpha);
    }
}
