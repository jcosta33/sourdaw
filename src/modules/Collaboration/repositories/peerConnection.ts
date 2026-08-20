import { logger } from '#/infra/logger/appLogger';

import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import {
    ChunkAssembler,
    parseChunkFrame,
    resolveMaxFrameBytes,
    splitMessageIntoFrames,
    utf8ByteLength,
} from '../models/SyncChannelFraming';

/**
 * Default ICE servers for NAT traversal.
 *
 * STUN only reveals each peer's public IP to themselves — no data
 * flows through these servers. The actual connection is direct P2P
 * with DTLS encryption.
 */
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
];

/** Get the current ICE server configuration. */
function getIceConfig(): RTCConfiguration {
    return { iceServers: DEFAULT_ICE_SERVERS };
}

type PeerConnectionCallbacks = {
    onMessage: ({ peerId, message }: { peerId: PeerId; message: PeerMessage }) => void;
    onConnected: (peerId: PeerId) => void;
    onDisconnected: (peerId: PeerId) => void;
    /**
     * A message could not be handed to the transport. Reported for the
     * fire-and-forget paths (broadcasts) whose caller has no promise to await,
     * so a failed delivery is never merely dropped.
     */
    onSendError?: ({ peerId, error }: { peerId: PeerId; error: unknown }) => void;
};

/**
 * Send-buffer high-water mark. W3C WebRTC §6.2's `send()` algorithm throws an
 * `OperationError` when "queuing data is not possible because not enough buffer
 * space is available", so a multi-frame transfer must wait for the buffer to
 * drain rather than race it. `bufferedAmount` /
 * `bufferedAmountLowThreshold` are the standard signal for that.
 */
const SEND_BUFFER_HIGH_WATER_MARK = 256 * 1024;

let messageSequence = 0;

/** A per-message id for chunk framing. Contains no `:`, and stays short. */
function nextMessageId(): string {
    messageSequence += 1;
    return `${Date.now().toString(36)}-${messageSequence.toString(36)}`;
}

/**
 * Resolve once the channel's send buffer has drained below the high-water mark.
 * Rejects if the channel closes while waiting, so a stalled peer surfaces as a
 * failed send instead of a promise that never settles.
 */
function waitForSendBuffer(channel: RTCDataChannel): Promise<void> {
    if (channel.bufferedAmount <= SEND_BUFFER_HIGH_WATER_MARK) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
        channel.bufferedAmountLowThreshold = SEND_BUFFER_HIGH_WATER_MARK / 2;

        function cleanup(): void {
            channel.removeEventListener('bufferedamountlow', onDrained);
            channel.removeEventListener('close', onClosed);
        }
        function onDrained(): void {
            cleanup();
            resolve();
        }
        function onClosed(): void {
            cleanup();
            reject(new Error('Data channel closed while waiting for its send buffer to drain'));
        }

        channel.addEventListener('bufferedamountlow', onDrained);
        channel.addEventListener('close', onClosed);
    });
}

/**
 * Whether the channel can currently take data.
 *
 * Read through a call rather than inline so a check after an `await` is not
 * folded away by narrowing from an earlier one — the state genuinely changes
 * while a multi-frame transfer is suspended on backpressure.
 */
function isChannelOpen(channel: RTCDataChannel): boolean {
    return channel.readyState === 'open';
}

/**
 * Manages a single WebRTC peer connection with two data channels:
 * - `crdt-sync`: reliable, ordered — for Automerge sync messages
 * - `presence`: unreliable, unordered — for ephemeral presence data
 */
class PeerConnection {
    peerId: PeerId;
    readonly rtc: RTCPeerConnection;
    private crdtChannel: RTCDataChannel | null = null;
    private presenceChannel: RTCDataChannel | null = null;
    private callbacks: PeerConnectionCallbacks;
    private connected = false;
    /** Rebuilds messages the sender had to split across several SCTP messages. */
    private readonly crdtAssembler = new ChunkAssembler();
    /** Tail of the CRDT channel's send chain — see {@link sendCrdtSync}. */
    private crdtSendQueue: Promise<void> = Promise.resolve();

    constructor(peerId: PeerId, callbacks: PeerConnectionCallbacks) {
        this.peerId = peerId;
        this.callbacks = callbacks;

        this.rtc = new RTCPeerConnection(getIceConfig());

        this.rtc.onconnectionstatechange = () => {
            const state = this.rtc.connectionState;
            if (state === 'disconnected' || state === 'failed') {
                if (this.connected) {
                    this.connected = false;
                    this.callbacks.onDisconnected(this.peerId);
                }
                return;
            }

            // W3C WebRTC defines `disconnected` as transient: ICE can recover
            // to `connected` with the data channels never closing, so
            // `onopen` — the only other path to `onConnected` — cannot fire
            // again. Without this the recovery is invisible and the peer stays
            // disconnected forever while its channels keep carrying traffic.
            if (state === 'connected' && !this.connected && this.isReady()) {
                this.connected = true;
                this.callbacks.onConnected(this.peerId);
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

    /**
     * Send a message over the CRDT sync channel.
     *
     * Resolves only once every byte has been handed to the transport, and
     * rejects when it could not be — the caller must not treat the message as
     * delivered until this settles. Messages larger than the negotiated SCTP
     * limit are split into frames and reassembled by the receiver.
     *
     * Sends are serialized per channel: the Automerge sync protocol depends on
     * message order, which interleaved frames from concurrent sends would break.
     */
    sendCrdtSync(message: PeerMessage): Promise<void> {
        const send = this.crdtSendQueue.then(
            () => this.deliverOnCrdtChannel(message),
            () => this.deliverOnCrdtChannel(message)
        );
        // The queue tracks completion only; a failed send must not poison the
        // sends that follow it.
        this.crdtSendQueue = send.then(
            () => undefined,
            () => undefined
        );
        return send;
    }

    /**
     * Alias retained for bulk transfers (asset chunks). Every CRDT-channel send
     * now applies the same backpressure, so this is {@link sendCrdtSync}.
     */
    sendCrdtSyncBuffered(message: PeerMessage): Promise<void> {
        return this.sendCrdtSync(message);
    }

    /**
     * Send presence data over the unreliable, unordered channel.
     *
     * Presence is never framed: reassembly needs reliable, ordered delivery,
     * which this channel deliberately does not provide (`maxRetransmits: 0`).
     * An oversized presence delta is refused rather than sent into a `TypeError`.
     */
    sendPresence(message: PeerMessage): void {
        const channel = this.presenceChannel;
        if (channel?.readyState !== 'open') {
            return;
        }

        const text = JSON.stringify(message);
        if (utf8ByteLength(text) > resolveMaxFrameBytes(this.rtc.sctp?.maxMessageSize)) {
            logger.warn('[PeerConnection] Dropping an oversized presence message for peer', this.peerId);
            return;
        }

        channel.send(text);
    }

    /** Hand one message to the CRDT channel, frame by frame, with backpressure. */
    private async deliverOnCrdtChannel(message: PeerMessage): Promise<void> {
        const channel = this.crdtChannel;
        if (!channel || !isChannelOpen(channel)) {
            throw new Error(`CRDT channel for peer ${this.peerId} is not open`);
        }

        const frames = splitMessageIntoFrames({
            text: JSON.stringify(message),
            maxFrameBytes: resolveMaxFrameBytes(this.rtc.sctp?.maxMessageSize),
            messageId: nextMessageId(),
        });

        for (const frame of frames) {
            await waitForSendBuffer(channel);
            if (!isChannelOpen(channel)) {
                throw new Error(`CRDT channel for peer ${this.peerId} closed mid-transfer`);
            }
            channel.send(frame);
        }
    }

    /** Update the peer identifier after handshake completes. */
    setPeerId(newPeerId: PeerId): void {
        this.peerId = newPeerId;
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
        this.crdtAssembler.clear();
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

    /**
     * Resolve one inbound wire string to a complete message, or `null` when it
     * is a chunk that does not complete one yet.
     */
    private readWholeMessage({ channelLabel, data }: { channelLabel: string; data: string }): string | null {
        const frame = parseChunkFrame(data);
        if (!frame) {
            return data;
        }
        if (channelLabel !== 'crdt-sync') {
            // Only the reliable, ordered channel can carry framed messages.
            return null;
        }
        return this.crdtAssembler.accept(frame);
    }

    private setupChannel(channel: RTCDataChannel): void {
        if (channel.label === 'crdt-sync') {
            this.crdtChannel = channel;
        } else if (channel.label === 'presence') {
            this.presenceChannel = channel;
        }

        channel.onmessage = (event) => {
            const data: unknown = event.data;
            if (typeof data !== 'string') {
                return;
            }

            const text = this.readWholeMessage({ channelLabel: channel.label, data });
            if (text === null) {
                return;
            }

            try {
                const message = JSON.parse(text) as PeerMessage;
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
            if (channel.label === 'crdt-sync') {
                // Half-delivered messages can never complete on a closed channel.
                this.crdtAssembler.clear();
                if (this.connected) {
                    this.connected = false;
                    this.callbacks.onDisconnected(this.peerId);
                }
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

    /**
     * Re-key an existing peer connection from a pending slot to its confirmed peer ID.
     */
    rekeyPeer(oldPeerId: PeerId, newPeerId: PeerId): boolean {
        const peer = this.peers.get(oldPeerId);
        if (!peer || oldPeerId === newPeerId) {
            return false;
        }
        this.peers.delete(oldPeerId);
        peer.setPeerId(newPeerId);
        this.peers.set(newPeerId, peer);
        return true;
    }

    /** Remove and close a peer connection. */
    removePeer(peerId: PeerId): void {
        const peer = this.peers.get(peerId);
        if (peer) {
            peer.close();
            this.peers.delete(peerId);
        }
    }

    /**
     * Send a CRDT sync message to a specific peer.
     *
     * Resolves once the transport has taken every byte; rejects if it could
     * not. An unknown peer is a no-op, as before.
     */
    async sendCrdtSync({ peerId, message }: { peerId: PeerId; message: PeerMessage }): Promise<void> {
        await this.peers.get(peerId)?.sendCrdtSync(message);
    }

    /** Send a CRDT sync message with backpressure (for bulk transfers). */
    async sendCrdtSyncBuffered({ peerId, message }: { peerId: PeerId; message: PeerMessage }): Promise<void> {
        await this.peers.get(peerId)?.sendCrdtSyncBuffered(message);
    }

    /**
     * Send a CRDT sync message to all connected peers.
     *
     * Fire-and-forget by contract, so a failure is reported through
     * `onSendError` rather than returned — the caller has no promise to await.
     */
    broadcastCrdtSync(message: PeerMessage): void {
        for (const [peerId, peer] of this.peers) {
            if (peer.isReady()) {
                peer.sendCrdtSync(message).catch((error: unknown) => {
                    this.callbacks.onSendError?.({ peerId, error });
                });
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
