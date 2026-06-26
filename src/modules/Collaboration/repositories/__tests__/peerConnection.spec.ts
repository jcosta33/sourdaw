import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type PeerMessage } from '../../models/CollaborationTypes';
import { PeerConnectionManager } from '../peerConnection';

/**
 * jsdom provides no WebRTC. These fakes implement just enough of the
 * RTCDataChannel / RTCPeerConnection surface that PeerConnection touches, so
 * the manager's routing behaviour (which peer a message reaches, which peers
 * count as connected) can be observed through the channels' `send`/`close`.
 */
class FakeDataChannel {
    readonly label: string;
    readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onbufferedamountlow: (() => void) | null = null;

    readonly send = vi.fn((_data: string) => {});
    readonly close = vi.fn(() => {
        this.readyState = 'closed';
        this.onclose?.();
    });

    constructor(label: string) {
        this.label = label;
    }

    /** Test helper: transition to open and fire the open handler. */
    open(): void {
        this.readyState = 'open';
        this.onopen?.();
    }
}

class FakeRTCPeerConnection {
    connectionState: RTCPeerConnectionState = 'new';
    iceGatheringState: RTCIceGatheringState = 'complete';
    localDescription: RTCSessionDescription | null = null;
    onconnectionstatechange: (() => void) | null = null;
    ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;

    readonly channels: FakeDataChannel[] = [];
    readonly close = vi.fn(() => {
        this.connectionState = 'closed';
    });

    createDataChannel(label: string): FakeDataChannel {
        const channel = new FakeDataChannel(label);
        this.channels.push(channel);
        return channel;
    }

    // Minimal SDP negotiation — PeerConnection.createOffer() drives all of
    // these. waitForIceGathering returns immediately because iceGatheringState
    // is already 'complete'.
    createOffer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({ type: 'offer', sdp: 'fake-offer' });
    }

    createAnswer(): Promise<RTCSessionDescriptionInit> {
        return Promise.resolve({ type: 'answer', sdp: 'fake-answer' });
    }

    setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
        this.localDescription = description as RTCSessionDescription;
        return Promise.resolve();
    }

    setRemoteDescription(): Promise<void> {
        return Promise.resolve();
    }

    addEventListener(): void {}
    removeEventListener(): void {}

    crdtChannel(): FakeDataChannel {
        return this.channels.find((c) => c.label === 'crdt-sync')!;
    }
}

const originalRTC = globalThis.RTCPeerConnection;

const noopCallbacks = {
    onMessage: vi.fn(),
    onConnected: vi.fn(),
    onDisconnected: vi.fn(),
};

/**
 * Create a peer through the manager and bring its CRDT channel to the open
 * state so it counts as "ready" — this is the only path the manager exposes
 * for a peer to become connected.
 */
async function addReadyPeer(manager: PeerConnectionManager, peerId: string): Promise<FakeRTCPeerConnection> {
    const peer = manager.createPeer(peerId);
    // createOffer builds the crdt-sync + presence channels.
    await peer.createOffer();
    const rtc = peer.rtc as unknown as FakeRTCPeerConnection;
    rtc.crdtChannel().open();
    return rtc;
}

const sampleMessage: PeerMessage = { type: 'crdt-sync', docId: 'doc-1', data: 'payload' };

describe('PeerConnectionManager', () => {
    let manager: PeerConnectionManager;

    beforeEach(() => {
        globalThis.RTCPeerConnection = FakeRTCPeerConnection as unknown as typeof RTCPeerConnection;
        vi.clearAllMocks();
        manager = new PeerConnectionManager({ ...noopCallbacks });
    });

    afterEach(() => {
        globalThis.RTCPeerConnection = originalRTC;
    });

    it('sendCrdtSync delivers only to the named peer', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const bob = await addReadyPeer(manager, 'bob');

        manager.sendCrdtSync({ peerId: 'alice', message: sampleMessage });

        expect(alice.crdtChannel().send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));
        expect(bob.crdtChannel().send).not.toHaveBeenCalled();
    });

    it('sendCrdtSync to an unknown peer is a no-op (does not throw)', () => {
        expect(() => manager.sendCrdtSync({ peerId: 'ghost', message: sampleMessage })).not.toThrow();
    });

    it('broadcastCrdtSync reaches only ready peers', async () => {
        const ready = await addReadyPeer(manager, 'ready');
        // 'pending' is created but its channel never opens → not ready.
        const pendingPeer = manager.createPeer('pending');
        await pendingPeer.createOffer();
        const pending = pendingPeer.rtc as unknown as FakeRTCPeerConnection;

        manager.broadcastCrdtSync(sampleMessage);

        expect(ready.crdtChannel().send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));
        expect(pending.crdtChannel().send).not.toHaveBeenCalled();
    });

    it('getConnectedPeerIds lists only peers whose CRDT channel is open', async () => {
        await addReadyPeer(manager, 'connected');
        const pendingPeer = manager.createPeer('connecting');
        await pendingPeer.createOffer();

        expect(manager.getConnectedPeerIds()).toEqual(['connected']);
    });

    it('removePeer closes the channels and stops routing to it', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const channel = alice.crdtChannel();

        manager.removePeer('alice');

        expect(channel.close).toHaveBeenCalled();
        expect(alice.close).toHaveBeenCalled();
        expect(manager.getPeer('alice')).toBeUndefined();
        expect(manager.getConnectedPeerIds()).toEqual([]);

        // A subsequent send to the removed peer goes nowhere.
        manager.sendCrdtSync({ peerId: 'alice', message: sampleMessage });
        expect(channel.send).not.toHaveBeenCalled();
    });

    it('closeAll tears down every connection', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const bob = await addReadyPeer(manager, 'bob');

        manager.closeAll();

        expect(alice.close).toHaveBeenCalled();
        expect(bob.close).toHaveBeenCalled();
        expect(manager.getConnectedPeerIds()).toEqual([]);
        expect(manager.getPeer('alice')).toBeUndefined();
        expect(manager.getPeer('bob')).toBeUndefined();
    });

    it('createPeer replaces an existing connection for the same id, closing the old one', async () => {
        const first = await addReadyPeer(manager, 'dup');
        const replacement = manager.createPeer('dup');

        expect(first.close).toHaveBeenCalled();
        expect(manager.getPeer('dup')).toBe(replacement);
    });
});
