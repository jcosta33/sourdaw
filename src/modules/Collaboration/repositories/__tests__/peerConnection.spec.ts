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
    readonly setRemoteDescription = vi.fn((): Promise<void> => Promise.resolve());
    private readonly iceListeners = new Set<() => void>();

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

    addEventListener(_type: string, listener: () => void): void {
        this.iceListeners.add(listener);
    }

    removeEventListener(_type: string, listener: () => void): void {
        this.iceListeners.delete(listener);
    }

    /** Test helper: fire every registered icegatheringstatechange listener. */
    fireIceGatheringStateChange(): void {
        for (const listener of this.iceListeners) {
            listener();
        }
    }

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

    it('acceptOffer answers a remote offer and acceptAnswer applies a remote answer', async () => {
        const alice = manager.createPeer('alice');
        const answerSdp = await alice.acceptOffer(JSON.stringify({ type: 'offer', sdp: 'remote-offer' }));

        expect(JSON.parse(answerSdp)).toEqual({ type: 'answer', sdp: 'fake-answer' });

        const bob = manager.createPeer('bob');
        await expect(
            bob.acceptAnswer(JSON.stringify({ type: 'answer', sdp: 'remote-answer' }))
        ).resolves.toBeUndefined();
        const bobRtc = bob.rtc as unknown as FakeRTCPeerConnection;
        expect(bobRtc.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'remote-answer' });
    });

    it('routes an inbound data-channel message to onMessage and swallows malformed JSON', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const channel = alice.crdtChannel();

        channel.onmessage?.({ data: JSON.stringify(sampleMessage) });
        expect(noopCallbacks.onMessage).toHaveBeenCalledWith({ peerId: 'alice', message: sampleMessage });

        noopCallbacks.onMessage.mockClear();
        expect(() => channel.onmessage?.({ data: '{not json' })).not.toThrow();
        expect(noopCallbacks.onMessage).not.toHaveBeenCalled();
    });

    it('fires onDisconnected once when the RTC connection drops, and does not double-fire', async () => {
        const alice = await addReadyPeer(manager, 'alice');

        alice.connectionState = 'disconnected';
        alice.onconnectionstatechange?.();
        alice.onconnectionstatechange?.();

        expect(noopCallbacks.onDisconnected).toHaveBeenCalledTimes(1);
        expect(noopCallbacks.onDisconnected).toHaveBeenCalledWith('alice');
    });

    it('wires an inbound (joiner-side) data channel via ondatachannel, tracking connect/disconnect', () => {
        const peer = manager.createPeer('joiner');
        const rtc = peer.rtc as unknown as FakeRTCPeerConnection;
        const inboundCrdt = new FakeDataChannel('crdt-sync');
        const inboundPresence = new FakeDataChannel('presence');

        rtc.ondatachannel?.({ channel: inboundCrdt });
        rtc.ondatachannel?.({ channel: inboundPresence });
        inboundCrdt.open();

        expect(noopCallbacks.onConnected).toHaveBeenCalledWith('joiner');
        expect(peer.isReady()).toBe(true);

        inboundCrdt.close();
        expect(noopCallbacks.onDisconnected).toHaveBeenCalledWith('joiner');
    });

    it('waitForIceGathering resolves once iceGatheringState reaches complete via the event listener', async () => {
        const peer = manager.createPeer('slow-ice');
        const rtc = peer.rtc as unknown as FakeRTCPeerConnection;
        rtc.iceGatheringState = 'gathering';

        const offerPromise = peer.createOffer();
        // Let createOffer's two internal awaits (rtc.createOffer(),
        // rtc.setLocalDescription()) settle so waitForIceGathering actually
        // registers its icegatheringstatechange listener before we fire it.
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        rtc.iceGatheringState = 'complete';
        rtc.fireIceGatheringStateChange();

        await expect(offerPromise).resolves.toEqual(expect.any(String));
    });

    it('waitForIceGathering falls back to its 10s timeout when no event ever fires', async () => {
        vi.useFakeTimers();
        try {
            const peer = manager.createPeer('stuck-ice');
            const rtc = peer.rtc as unknown as FakeRTCPeerConnection;
            rtc.iceGatheringState = 'gathering';

            const offerPromise = peer.createOffer();
            await vi.advanceTimersByTimeAsync(10_000);

            await expect(offerPromise).resolves.toEqual(expect.any(String));
        } finally {
            vi.useRealTimers();
        }
    });

    it('sendCrdtSyncBuffered sends immediately under the high-water mark and is a no-op on a closed channel', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const channel = alice.crdtChannel();

        await manager.sendCrdtSyncBuffered({ peerId: 'alice', message: sampleMessage });
        expect(channel.send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));

        channel.send.mockClear();
        channel.readyState = 'closed';
        await manager.sendCrdtSyncBuffered({ peerId: 'alice', message: sampleMessage });
        expect(channel.send).not.toHaveBeenCalled();

        // Unknown peer is a no-op too.
        await expect(
            manager.sendCrdtSyncBuffered({ peerId: 'ghost', message: sampleMessage })
        ).resolves.toBeUndefined();
    });

    it('sendCrdtSyncBuffered awaits the buffer draining below the high-water mark before sending', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const channel = alice.crdtChannel();
        channel.bufferedAmount = 300 * 1024;

        let settled = false;
        const sendPromise = manager.sendCrdtSyncBuffered({ peerId: 'alice', message: sampleMessage }).then(() => {
            settled = true;
        });

        await Promise.resolve();
        expect(settled).toBe(false);
        expect(channel.send).not.toHaveBeenCalled();

        channel.onbufferedamountlow?.();
        await sendPromise;

        expect(settled).toBe(true);
        expect(channel.send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));
    });

    it('broadcastPresence reaches only ready peers', async () => {
        const ready = await addReadyPeer(manager, 'ready');
        ready.channels.find((channel) => channel.label === 'presence')!.open();
        const pendingPeer = manager.createPeer('pending');
        await pendingPeer.createOffer();
        const pending = pendingPeer.rtc as unknown as FakeRTCPeerConnection;
        const presenceMessage: PeerMessage = { type: 'presence', data: { peerId: 'ready', name: 'A', color: '#fff' } };

        manager.broadcastPresence(presenceMessage);

        const readyPresenceChannel = ready.channels.find((channel) => channel.label === 'presence')!;
        const pendingPresenceChannel = pending.channels.find((channel) => channel.label === 'presence')!;
        expect(readyPresenceChannel.send).toHaveBeenCalledWith(JSON.stringify(presenceMessage));
        expect(pendingPresenceChannel.send).not.toHaveBeenCalled();
    });
});
