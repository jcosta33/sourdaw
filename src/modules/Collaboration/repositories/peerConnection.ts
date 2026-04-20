import { createStore } from '#/infra/store/createStore';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';

/**
 * Default ICE servers for NAT traversal.
 *
 * STUN only reveals each peer's public IP to themselves — no data
 * flows through these servers. The actual connection is direct P2P
 * with DTLS encryption.
 *
 * Users can override this via advanced settings to use their own
 * STUN/TURN servers or disable STUN entirely for strict zero-server mode.
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

// Wrapped in a store rather than a module-level `let` so the only way to
// mutate it is through the setter below — `export let` would allow any
// importer to reassign this silently.
const iceServersStore = createStore<RTCIceServer[] | null>({ initialData: null });

/** Override the default ICE servers (for advanced settings / strict zero-server mode). */
export function setIceServers(servers: RTCIceServer[] | null): void {
    iceServersStore.set(servers);
}

/** Get the current ICE server configuration. */
const getIceConfig = (): RTCConfiguration => {
    const servers = iceServersStore.value ?? DEFAULT_ICE_SERVERS;
    return { iceServers: servers };
};

type PeerConnectionCallbacks = {
    onMessage: ({ peerId, message }: { peerId: PeerId; message: PeerMessage }) => void;
    onConnected: (peerId: PeerId) => void;
    onDisconnected: (peerId: PeerId) => void;
};

/**
 * Manages a single WebRTC peer connection with two data channels:
 * - `crdt-sync`: reliable, ordered — for Automerge sync messages
 * - `presence`: unreliable, unordered — for ephemeral presence data
 */
class PeerConnection {
    readonly peerId: PeerId;
    readonly rtc: RTCPeerConnection;
    private crdtChannel: RTCDataChannel | null = null;
    private presenceChannel: RTCDataChannel | null = null;
    private callbacks: PeerConnectionCallbacks;
    private connected = false;

    constructor(peerId: PeerId, callbacks: PeerConnectionCallbacks) {
        this.peerId = peerId;
        this.callbacks = callbacks;

        this.rtc = new RTCPeerConnection(getIceConfig());

        this.rtc.onconnectionstatechange = () => {
            if (this.rtc.connectionState === 'disconnected' || this.rtc.connectionState === 'failed') {
                if (this.connected) {
                    this.connected = false;
                    this.callbacks.onDisconnected(this.peerId);
                }
            }
        };

        this.rtc.ondatachannel = (event) => {
            this.setupChannel(event.channel);
        };
    }

    /** Create data channels and generate an SDP offer (caller/host side). */
    async createOffer(): Promise<string> {
        this.crdtChannel = this.rtc.createDataChannel('crdt-sync', {
            ordered: true,
        });
        this.setupChannel(this.crdtChannel);

        this.presenceChannel = this.rtc.createDataChannel('presence', {
            ordered: false,
            maxRetransmits: 0,
        });
        this.setupChannel(this.presenceChannel);

        const offer = await this.rtc.createOffer();
        await this.rtc.setLocalDescription(offer);
        await this.waitForIceGathering();
        return JSON.stringify(this.rtc.localDescription);
    }

    /** Accept an SDP offer and generate an answer (joiner side). */
    async acceptOffer(offerSdp: string): Promise<string> {
        const offer = JSON.parse(offerSdp) as RTCSessionDescriptionInit;
        await this.rtc.setRemoteDescription(offer);
        const answer = await this.rtc.createAnswer();
        await this.rtc.setLocalDescription(answer);
        await this.waitForIceGathering();
        return JSON.stringify(this.rtc.localDescription);
    }

    /** Apply the remote answer (caller side after receiving joiner's answer). */
    async acceptAnswer(answerSdp: string): Promise<void> {
        const answer = JSON.parse(answerSdp) as RTCSessionDescriptionInit;
        await this.rtc.setRemoteDescription(answer);
    }

    /** Send a message over the CRDT sync channel. */
    sendCrdtSync(message: PeerMessage): void {
        if (this.crdtChannel?.readyState === 'open') {
            this.crdtChannel.send(JSON.stringify(message));
        }
    }

    /**
     * Send a message over the CRDT sync channel, waiting for the send buffer
     * to drain if it exceeds the high-water mark. Use this for bulk transfers
     * (asset chunks) to avoid overflowing the channel buffer.
     */
    async sendCrdtSyncBuffered(message: PeerMessage): Promise<void> {
        const channel = this.crdtChannel;
        if (!channel || channel.readyState !== 'open') {
            return;
        }

        const HIGH_WATER_MARK = 256 * 1024;
        if (channel.bufferedAmount > HIGH_WATER_MARK) {
            await new Promise<void>((resolve) => {
                channel.bufferedAmountLowThreshold = HIGH_WATER_MARK / 2;
                const prev = channel.onbufferedamountlow;
                channel.onbufferedamountlow = () => {
                    channel.onbufferedamountlow = prev;
                    resolve();
                };
            });
        }

        if (channel.readyState === 'open') {
            channel.send(JSON.stringify(message));
        }
    }

    /** Send presence data over the unreliable channel. */
    sendPresence(message: PeerMessage): void {
        if (this.presenceChannel?.readyState === 'open') {
            this.presenceChannel.send(JSON.stringify(message));
        }
    }

    /** Check if the CRDT channel is open and ready. */
    isReady(): boolean {
        return this.crdtChannel?.readyState === 'open';
    }

    /** Close the connection and clean up. */
    close(): void {
        this.crdtChannel?.close();
        this.presenceChannel?.close();
        this.rtc.close();
        this.connected = false;
    }

    /**
     * Wait for ICE gathering to complete before returning the local SDP.
     * This ensures the SDP contains all candidates for the manual copy-paste flow.
     * Times out after 10 seconds to avoid hanging on unreachable STUN servers.
     */
    private waitForIceGathering(): Promise<void> {
        return new Promise((resolve) => {
            if (this.rtc.iceGatheringState === 'complete') {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                this.rtc.removeEventListener('icegatheringstatechange', onStateChange);
                resolve();
            }, 10_000);

            const onStateChange = () => {
                if (this.rtc.iceGatheringState === 'complete') {
                    clearTimeout(timeout);
                    this.rtc.removeEventListener('icegatheringstatechange', onStateChange);
                    resolve();
                }
            };

            this.rtc.addEventListener('icegatheringstatechange', onStateChange);
        });
    }

    private setupChannel(channel: RTCDataChannel): void {
        if (channel.label === 'crdt-sync') {
            this.crdtChannel = channel;
        } else if (channel.label === 'presence') {
            this.presenceChannel = channel;
        }

        channel.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data as string) as PeerMessage;
                this.callbacks.onMessage({ peerId: this.peerId, message });
            } catch {
                // Ignore malformed messages
            }
        };

        channel.onopen = () => {
            // When the CRDT channel opens, the connection is usable
            if (channel.label === 'crdt-sync' && !this.connected) {
                this.connected = true;
                this.callbacks.onConnected(this.peerId);
            }
        };

        channel.onclose = () => {
            if (channel.label === 'crdt-sync' && this.connected) {
                this.connected = false;
                this.callbacks.onDisconnected(this.peerId);
            }
        };
    }
}

/**
 * Manages all peer connections for a collaboration session.
 */
export class PeerConnectionManager {
    private peers = new Map<PeerId, PeerConnection>();
    private callbacks: PeerConnectionCallbacks;

    constructor(callbacks: PeerConnectionCallbacks) {
        this.callbacks = callbacks;
    }

    /** Create a new peer connection (before signaling). */
    createPeer(peerId: PeerId): PeerConnection {
        if (this.peers.has(peerId)) {
            this.peers.get(peerId)!.close();
        }
        const peer = new PeerConnection(peerId, this.callbacks);
        this.peers.set(peerId, peer);
        return peer;
    }

    /** Get an existing peer connection. */
    getPeer(peerId: PeerId): PeerConnection | undefined {
        return this.peers.get(peerId);
    }

    /** Remove and close a peer connection. */
    removePeer(peerId: PeerId): void {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.close();
            this.peers.delete(peerId);
        }
    }

    /** Send a CRDT sync message to a specific peer. */
    sendCrdtSync({ peerId, message }: { peerId: PeerId; message: PeerMessage }): void {
        this.peers.get(peerId)?.sendCrdtSync(message);
    }

    /** Send a CRDT sync message with backpressure (for bulk transfers). */
    async sendCrdtSyncBuffered({ peerId, message }: { peerId: PeerId; message: PeerMessage }): Promise<void> {
        await this.peers.get(peerId)?.sendCrdtSyncBuffered(message);
    }

    /** Send a CRDT sync message to all connected peers. */
    broadcastCrdtSync(message: PeerMessage): void {
        for (const peer of this.peers.values()) {
            if (peer.isReady()) {
                peer.sendCrdtSync(message);
            }
        }
    }

    /** Send presence data to all connected peers. */
    broadcastPresence(message: PeerMessage): void {
        for (const peer of this.peers.values()) {
            if (peer.isReady()) {
                peer.sendPresence(message);
            }
        }
    }

    /** Get all connected peer IDs. */
    getConnectedPeerIds(): PeerId[] {
        const ids: PeerId[] = [];
        for (const [id, peer] of this.peers) {
            if (peer.isReady()) {
                ids.push(id);
            }
        }
        return ids;
    }

    /** Close all connections. */
    closeAll(): void {
        for (const peer of this.peers.values()) {
            peer.close();
        }
        this.peers.clear();
    }
}
