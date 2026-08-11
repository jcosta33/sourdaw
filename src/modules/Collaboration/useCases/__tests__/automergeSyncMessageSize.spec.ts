import { init as automergeInit, change, type Doc } from '@automerge/automerge';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    subscribeToCrdtChanges,
    getCrdtDoc,
    getCrdtDocIds,
    hasCrdtDoc,
    replaceCrdtDoc,
} from '#/modules/CrdtDocument/useCases';

import { PeerConnectionManager } from '../../repositories/peerConnection';
import { AutomergeSync, type AutomergeSyncHooks } from '../automergeSync';

import { createPeerSyncMessages } from './peerSyncHandshake';

vi.mock('#/modules/Command/useCases', () => ({
    syncActionReplayMetadata: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    subscribeToCrdtChanges: vi.fn(),
    getCrdtDoc: vi.fn(),
    createCrdtDoc: vi.fn(),
    replaceCrdtDoc: vi.fn(),
    hasCrdtDoc: vi.fn().mockReturnValue(false),
    getCrdtDocIds: vi.fn().mockReturnValue([]),
    persistCrdtProject: vi.fn().mockResolvedValue(undefined),
    waitForCrdtDocumentTransition: vi.fn().mockReturnValue(null),
    sanitizeIncomingCrdtDocument: vi.fn((document) => document),
    DOC_PREFIX_ROOT: 'root',
    DOC_BRANCHES: '__branches__',
}));

/**
 * Chrome negotiates 262144 bytes for SCTP user messages; the value is read at
 * runtime from `RTCSctpTransport.maxMessageSize` (W3C WebRTC §6.1.1, and
 * §6.1.1.2 "Update max message size"). The fake pins it to that value so the
 * spec exercises the same threshold a real join hits.
 */
const CHROME_MAX_MESSAGE_SIZE = 262_144;

function utf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length;
}

/**
 * A data channel that enforces the normative `send()` algorithm of the W3C
 * WebRTC spec (§6.2 RTCDataChannel):
 *
 *   "If the byte size of data exceeds the value of maxMessageSize on channel's
 *    associated RTCSctpTransport, throw a TypeError."
 *
 * jsdom has no WebRTC, so without this the defect is invisible in tests: the
 * repo's other fake channel accepts any payload.
 */
class SizeCheckedDataChannel {
    readonly label: string;
    readyState: 'connecting' | 'open' | 'closing' | 'closed' = 'connecting';
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    maxMessageSize = CHROME_MAX_MESSAGE_SIZE;
    onmessage: ((event: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onbufferedamountlow: (() => void) | null = null;
    readonly sent: string[] = [];

    constructor(label: string) {
        this.label = label;
    }

    send(data: string): void {
        if (this.readyState !== 'open') {
            throw new DOMException('channel is not open', 'InvalidStateError');
        }
        if (utf8ByteLength(data) > this.maxMessageSize) {
            throw new TypeError('Failure to send data');
        }
        this.sent.push(data);
    }

    close(): void {
        this.readyState = 'closed';
        this.onclose?.();
    }

    open(): void {
        this.readyState = 'open';
        this.onopen?.();
    }
}

class SizeCheckedPeerConnection {
    connectionState: RTCPeerConnectionState = 'new';
    iceGatheringState: RTCIceGatheringState = 'complete';
    localDescription: RTCSessionDescription | null = null;
    onconnectionstatechange: (() => void) | null = null;
    ondatachannel: ((event: { channel: SizeCheckedDataChannel }) => void) | null = null;
    readonly channels: SizeCheckedDataChannel[] = [];
    /** The negotiated SCTP transport, per W3C WebRTC §6.1.1. */
    readonly sctp = { maxMessageSize: CHROME_MAX_MESSAGE_SIZE };

    createDataChannel(label: string): SizeCheckedDataChannel {
        const channel = new SizeCheckedDataChannel(label);
        this.channels.push(channel);
        return channel;
    }

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
    close(): void {
        this.connectionState = 'closed';
    }

    crdtChannel(): SizeCheckedDataChannel {
        return this.channels.find((channel) => channel.label === 'crdt-sync')!;
    }
}

type ProjectDoc = { notes: string[] };

/**
 * A document whose Automerge sync message is larger than the negotiated SCTP
 * limit — i.e. "any real project". Automerge compresses its change columns, so
 * the payload is built from high-entropy text to keep the encoded size honest.
 */
function createOversizedProjectDoc(): Doc<ProjectDoc> {
    // xorshift32 — deterministic, and every step stays inside 32-bit integer
    // range so the low bits are real entropy rather than float rounding.
    let seed = 0x2f_6e_2b_11;
    function nextChar(): string {
        seed ^= seed << 13;
        seed >>>= 0;
        seed ^= seed >>> 17;
        seed ^= seed << 5;
        seed >>>= 0;
        return String.fromCharCode(33 + (seed % 94));
    }
    return change(automergeInit<ProjectDoc>('bbbbbbbbbbbbbbbb'), (draft) => {
        draft.notes = [];
        for (let index = 0; index < 400; index++) {
            let note = '';
            for (let position = 0; position < 1024; position++) {
                note += nextChar();
            }
            draft.notes.push(note);
        }
    });
}

const originalRTC = globalThis.RTCPeerConnection;

type Harness = {
    manager: PeerConnectionManager;
    channel: SizeCheckedDataChannel;
    sync: AutomergeSync;
    /** Fire the repository's local-change notification for one document. */
    notifyLocalChange: (docId: string) => void;
    /** The base64 handshake message an empty joiner sends first. */
    joinerHandshake: string;
};

describe('AutomergeSync over an SCTP-limited data channel', () => {
    let projectDoc: Doc<ProjectDoc>;

    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.RTCPeerConnection = SizeCheckedPeerConnection as unknown as typeof RTCPeerConnection;
        projectDoc = createOversizedProjectDoc();
        vi.mocked(getCrdtDoc).mockImplementation((docId: string) => (docId === 'root' ? projectDoc : undefined));
        // Mirror the repository: a received sync replaces the stored document,
        // and `receiveSyncMessage` outdates the one it was handed.
        vi.mocked(replaceCrdtDoc).mockImplementation(({ id, doc }: { id: string; doc: Doc<unknown> }) => {
            if (id === 'root') {
                projectDoc = doc as Doc<ProjectDoc>;
            }
        });
        vi.mocked(hasCrdtDoc).mockReturnValue(false);
        vi.mocked(getCrdtDocIds).mockReturnValue([]);
    });

    afterEach(() => {
        globalThis.RTCPeerConnection = originalRTC;
    });

    /**
     * Bring a host to the exact state a joiner reaches it in: connected peer,
     * handshake exchanged, and the peer's changes still to send.
     */
    async function connectJoiner(hooks: AutomergeSyncHooks = {}): Promise<Harness> {
        const manager = new PeerConnectionManager({
            onMessage: vi.fn(),
            onConnected: vi.fn(),
            onDisconnected: vi.fn(),
        });
        const peer = manager.createPeer('joiner');
        await peer.createOffer();
        const rtc = peer.rtc as unknown as SizeCheckedPeerConnection;
        const channel = rtc.crdtChannel();
        channel.open();

        let onLocalChange: ((docId?: string) => void) | undefined;
        vi.mocked(subscribeToCrdtChanges).mockImplementation((callback) => {
            onLocalChange = callback;
            return () => {};
        });

        const joinerHandshake = createPeerSyncMessages({
            remote: automergeInit(),
            local: projectDoc,
        })[0]!;

        const sync = new AutomergeSync(manager, hooks);
        sync.start();

        return {
            manager,
            channel,
            sync,
            notifyLocalChange: (docId: string) => onLocalChange?.(docId),
            joinerHandshake,
        };
    }

    it('the sync that answers a joiner exceeds the negotiated SCTP message size', async () => {
        const harness = await connectJoiner();

        // Round 1: the host's own handshake — heads and a bloom filter, small.
        harness.sync.addPeer('joiner');
        await vi.waitFor(() => {
            expect(harness.channel.sent.length).toBeGreaterThan(0);
        });
        const handshakeBytes = utf8ByteLength(harness.channel.sent[0]!);
        expect(handshakeBytes).toBeLessThan(CHROME_MAX_MESSAGE_SIZE);

        // Round 2: the joiner answers, so the host now owes it every change.
        harness.sync.receiveSync({
            peerId: 'joiner',
            docId: 'root',
            syncMessageBase64: harness.joinerHandshake,
        });
        harness.channel.maxMessageSize = Number.POSITIVE_INFINITY;
        harness.channel.sent.length = 0;
        harness.notifyLocalChange('root');
        await vi.waitFor(() => {
            expect(harness.channel.sent.length).toBeGreaterThan(0);
        });

        const totalBytes = harness.channel.sent.reduce((sum, frame) => sum + utf8ByteLength(frame), 0);
        expect(totalBytes).toBeGreaterThan(CHROME_MAX_MESSAGE_SIZE);
    });

    it('answering a joiner never hands the channel more than it negotiated', async () => {
        const harness = await connectJoiner();
        harness.sync.addPeer('joiner');
        harness.sync.receiveSync({
            peerId: 'joiner',
            docId: 'root',
            syncMessageBase64: harness.joinerHandshake,
        });
        harness.channel.sent.length = 0;

        harness.notifyLocalChange('root');

        await vi.waitFor(() => {
            expect(harness.channel.sent.length).toBeGreaterThan(0);
        });
        const oversized = harness.channel.sent.filter((frame) => utf8ByteLength(frame) > CHROME_MAX_MESSAGE_SIZE);
        expect(oversized).toEqual([]);
        // The payload was over the limit, so it can only have got out in pieces.
        expect(harness.channel.sent.length).toBeGreaterThan(1);
    });

    it('does not advance the peer sync state when the send fails, and says so', async () => {
        const onSendError = vi.fn();
        const harness = await connectJoiner({ onSendError });
        harness.sync.addPeer('joiner');
        harness.sync.receiveSync({
            peerId: 'joiner',
            docId: 'root',
            syncMessageBase64: harness.joinerHandshake,
        });
        harness.channel.sent.length = 0;

        // Every send fails while the joiner's changes are owed.
        harness.channel.maxMessageSize = 0;
        harness.notifyLocalChange('root');
        await vi.waitFor(() => {
            expect(onSendError).toHaveBeenCalledWith({
                peerId: 'joiner',
                docId: 'root',
                error: expect.any(TypeError),
            });
        });
        expect(harness.channel.sent).toHaveLength(0);

        // The transport recovers. Re-running the sync for the same, unchanged
        // document must reproduce the message that never left: the peer's
        // SyncState may only advance on a send that actually completed.
        harness.channel.maxMessageSize = Number.POSITIVE_INFINITY;
        harness.notifyLocalChange('root');

        await vi.waitFor(() => {
            expect(harness.channel.sent.length).toBeGreaterThan(0);
        });
    });
});
