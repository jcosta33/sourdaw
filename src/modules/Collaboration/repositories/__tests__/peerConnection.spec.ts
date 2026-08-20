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

    private readonly listeners = new Map<string, Set<() => void>>();

    readonly send = vi.fn((_data: string) => {});
    readonly close = vi.fn(() => {
        this.readyState = 'closed';
        this.onclose?.();
        this.dispatch('close');
    });

    constructor(label: string) {
        this.label = label;
    }

    addEventListener(type: string, listener: () => void): void {
        const existing = this.listeners.get(type) ?? new Set<() => void>();
        existing.add(listener);
        this.listeners.set(type, existing);
    }

    removeEventListener(type: string, listener: () => void): void {
        this.listeners.get(type)?.delete(listener);
    }

    /** Test helper: fire every listener registered for `type`. */
    dispatch(type: string): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) {
            listener();
        }
    }

    /** Test helper: transition to open and fire the open handler. */
    open(): void {
        this.readyState = 'open';
        this.onopen?.();
    }
}

class FakeRTCPeerConnection {
    connectionState: RTCPeerConnectionState = 'new';
    /**
     * The negotiated SCTP association. `RTCSctpTransport.maxMessageSize` (W3C
     * WebRTC §6.1.1) is the only source for the send ceiling; `null` stands for
     * a runtime that exposes no transport yet.
     */
    sctp: { maxMessageSize: number } | null = null;
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

        await manager.sendCrdtSync({ peerId: 'alice', message: sampleMessage });

        expect(alice.crdtChannel().send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));
        expect(bob.crdtChannel().send).not.toHaveBeenCalled();
    });

    it('sendCrdtSync to an unknown peer is a no-op (does not reject)', async () => {
        await expect(manager.sendCrdtSync({ peerId: 'ghost', message: sampleMessage })).resolves.toBeUndefined();
    });

    it('broadcastCrdtSync reaches only ready peers', async () => {
        const ready = await addReadyPeer(manager, 'ready');
        // 'pending' is created but its channel never opens → not ready.
        const pendingPeer = manager.createPeer('pending');
        await pendingPeer.createOffer();
        const pending = pendingPeer.rtc as unknown as FakeRTCPeerConnection;

        manager.broadcastCrdtSync(sampleMessage);

        await vi.waitFor(() => {
            expect(ready.crdtChannel().send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));
        });
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
        await manager.sendCrdtSync({ peerId: 'alice', message: sampleMessage });
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

    it('re-announces a peer whose transient ICE disconnect recovers to connected', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        // The initial channel open already announced it once.
        expect(noopCallbacks.onConnected).toHaveBeenCalledTimes(1);

        alice.connectionState = 'disconnected';
        alice.onconnectionstatechange?.();
        expect(noopCallbacks.onDisconnected).toHaveBeenCalledTimes(1);

        // W3C: `disconnected` is transient. ICE recovers with the data channel
        // never closing, so `onopen` can't re-fire — this is the only signal.
        alice.connectionState = 'connected';
        alice.onconnectionstatechange?.();

        expect(noopCallbacks.onConnected).toHaveBeenCalledTimes(2);
        expect(noopCallbacks.onConnected).toHaveBeenLastCalledWith('alice');

        // Already connected: a repeated state change must not announce again.
        alice.onconnectionstatechange?.();
        expect(noopCallbacks.onConnected).toHaveBeenCalledTimes(2);
    });

    it('does not announce a connected RTC state while the CRDT channel is not open', async () => {
        const peer = manager.createPeer('alice');
        await peer.createOffer();
        const rtc = peer.rtc as unknown as FakeRTCPeerConnection;

        rtc.connectionState = 'connected';
        rtc.onconnectionstatechange?.();

        expect(noopCallbacks.onConnected).not.toHaveBeenCalled();
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

    it('sendCrdtSyncBuffered sends under the high-water mark and reports a closed channel', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const channel = alice.crdtChannel();

        await manager.sendCrdtSyncBuffered({ peerId: 'alice', message: sampleMessage });
        expect(channel.send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));

        // A closed channel took nothing: the caller must learn that rather than
        // treat the message as delivered.
        channel.send.mockClear();
        channel.readyState = 'closed';
        await expect(manager.sendCrdtSyncBuffered({ peerId: 'alice', message: sampleMessage })).rejects.toThrow(
            /not open/
        );
        expect(channel.send).not.toHaveBeenCalled();

        // Unknown peer is a no-op.
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

        // Drain the microtask queue entirely: without backpressure the send
        // would already have gone out by now.
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(settled).toBe(false);
        expect(channel.send).not.toHaveBeenCalled();

        channel.dispatch('bufferedamountlow');
        await sendPromise;

        expect(settled).toBe(true);
        expect(channel.send).toHaveBeenCalledWith(JSON.stringify(sampleMessage));
    });

    it('rejects a send whose channel closes while it is waiting for the buffer to drain', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        const channel = alice.crdtChannel();
        channel.bufferedAmount = 300 * 1024;

        const sendPromise = manager.sendCrdtSyncBuffered({ peerId: 'alice', message: sampleMessage });
        await Promise.resolve();

        channel.close();

        await expect(sendPromise).rejects.toThrow(/closed while waiting/);
        expect(channel.send).not.toHaveBeenCalled();
    });

    it('splits a message past the negotiated SCTP size and the receiver rebuilds it exactly', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        alice.sctp = { maxMessageSize: 4096 };
        const channel = alice.crdtChannel();
        // Non-ASCII payload: a cut inside a multi-byte code point would corrupt
        // the rebuilt message rather than merely resize it.
        const big: PeerMessage = { type: 'crdt-sync', docId: 'root', data: 'é🥖x'.repeat(4000) };

        await manager.sendCrdtSync({ peerId: 'alice', message: big });

        const frames = channel.send.mock.calls.map(([data]) => data);
        expect(frames.length).toBeGreaterThan(1);
        for (const frame of frames) {
            expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(4096);
        }

        // Feed the frames to a second connection's inbound channel.
        const receiverCallbacks = {
            onMessage: vi.fn(),
            onConnected: vi.fn(),
            onDisconnected: vi.fn(),
        };
        const receiver = new PeerConnectionManager(receiverCallbacks);
        const receiverPeer = receiver.createPeer('alice');
        const inbound = new FakeDataChannel('crdt-sync');
        (receiverPeer.rtc as unknown as FakeRTCPeerConnection).ondatachannel?.({ channel: inbound });
        inbound.open();

        for (const frame of frames) {
            inbound.onmessage?.({ data: frame });
        }

        expect(receiverCallbacks.onMessage).toHaveBeenCalledTimes(1);
        expect(receiverCallbacks.onMessage).toHaveBeenCalledWith({ peerId: 'alice', message: big });
    });

    it('sizes frames from the negotiated limit, falling back when no SCTP transport exists', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        alice.sctp = { maxMessageSize: 2048 };
        const message: PeerMessage = { type: 'crdt-sync', docId: 'root', data: 'a'.repeat(20_000) };

        await manager.sendCrdtSync({ peerId: 'alice', message });
        const tightFrames = alice.crdtChannel().send.mock.calls.length;

        // With no transport to read, the fallback is the RFC 8831 §6.6 ceiling
        // of 16 KB — larger frames, so strictly fewer of them.
        const bob = await addReadyPeer(manager, 'bob');
        bob.sctp = null;
        await manager.sendCrdtSync({ peerId: 'bob', message });
        const fallbackFrames = bob.crdtChannel().send.mock.calls.length;

        expect(tightFrames).toBeGreaterThan(10);
        expect(fallbackFrames).toBeLessThan(tightFrames);
        for (const [frame] of bob.crdtChannel().send.mock.calls) {
            expect(new TextEncoder().encode(frame).length).toBeLessThanOrEqual(16 * 1024);
        }
    });

    it('refuses an oversized presence message rather than sending into a TypeError', async () => {
        const alice = await addReadyPeer(manager, 'alice');
        alice.sctp = { maxMessageSize: 1024 };
        const presenceChannel = alice.channels.find((channel) => channel.label === 'presence')!;
        presenceChannel.open();

        manager.broadcastPresence({
            type: 'presence',
            data: { peerId: 'alice', name: 'x'.repeat(5000), color: '#fff' },
        });

        expect(presenceChannel.send).not.toHaveBeenCalled();
    });

    it('broadcastCrdtSync reports a failed delivery instead of dropping it', async () => {
        const onSendError = vi.fn();
        const reporting = new PeerConnectionManager({ ...noopCallbacks, onSendError });
        const alice = await addReadyPeer(reporting, 'alice');
        const channel = alice.crdtChannel();
        channel.send.mockImplementation(() => {
            throw new TypeError('Failure to send data');
        });

        reporting.broadcastCrdtSync(sampleMessage);

        await vi.waitFor(() => {
            expect(onSendError).toHaveBeenCalledWith({ peerId: 'alice', error: expect.any(TypeError) });
        });
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

    describe('rekeyPeer', () => {
        it('re-keys an existing peer and updates its internal peerId for callbacks', async () => {
            const onConnected = vi.fn();
            const onMessage = vi.fn();
            const rekeyManager = new PeerConnectionManager({ ...noopCallbacks, onConnected, onMessage });

            const peer = rekeyManager.createPeer('pending-slot-1');
            await peer.createOffer();
            const fakeRtc = peer.rtc as unknown as FakeRTCPeerConnection;
            const channel = fakeRtc.channels.find((c) => c.label === 'crdt-sync')!;

            const rekeyResult = rekeyManager.rekeyPeer('pending-slot-1', 'confirmed-joiner-1');
            expect(rekeyResult).toBe(true);

            expect(rekeyManager.getPeer('pending-slot-1')).toBeUndefined();
            expect(rekeyManager.getPeer('confirmed-joiner-1')).toBe(peer);

            // Verify callbacks use the updated peerId
            channel.open();
            expect(onConnected).toHaveBeenCalledWith('confirmed-joiner-1');

            channel.onmessage?.({ data: JSON.stringify({ type: 'crdt-sync', docId: 'test', syncMessage: 'xyz' }) });
            expect(onMessage).toHaveBeenCalledWith({
                peerId: 'confirmed-joiner-1',
                message: expect.objectContaining({ type: 'crdt-sync' }),
            });
        });

        it('returns false when oldPeerId does not exist or matches newPeerId', () => {
            expect(manager.rekeyPeer('nonexistent', 'new-id')).toBe(false);
            manager.createPeer('same-id');
            expect(manager.rekeyPeer('same-id', 'same-id')).toBe(false);
        });
    });
});
