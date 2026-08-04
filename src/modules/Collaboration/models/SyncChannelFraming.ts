/**
 * Framing for peer messages that do not fit in a single SCTP user message.
 *
 * The limit is a negotiated property of the association, not a constant:
 *
 * - RFC 8841 §6.1 — the SDP `max-message-size` attribute indicates "the maximum
 *   SCTP user message size (indicated in bytes) that an SCTP endpoint is willing
 *   to receive"; an endpoint "MUST NOT send a SCTP user message with a message
 *   size that is larger than the maximum size indicated by the peer". When the
 *   attribute is absent, "the default value is 64K".
 * - W3C WebRTC (REC 13 March 2025) §6.1.1.2 "Update max message size" — the user
 *   agent reads `remoteMaxMessageSize` from that attribute "or 65536 if the
 *   attribute is missing", then sets `[[MaxMessageSize]]` to the smaller of it
 *   and what the local send buffer can take. §6.1.1 exposes the result as
 *   `RTCSctpTransport.maxMessageSize`.
 * - W3C WebRTC §6.2, the `send()` algorithm — "If the byte size of data exceeds
 *   the value of maxMessageSize on channel's associated RTCSctpTransport, throw
 *   a TypeError." That throw is what an unframed project sync walks into.
 * - RFC 8831 §6.6 — "As long as message interleaving is not supported, the
 *   sender SHOULD limit the maximum message size to 16 KB to avoid
 *   monopolization." Browsers do not negotiate the RFC 8260 interleaving
 *   extension, so a single multi-megabyte message would stall every other
 *   channel on the association for its whole transfer.
 *
 * So the frame ceiling is `min(negotiated, 16 KB)`: never above what the peer
 * agreed to accept, and never so large that one document sync monopolises the
 * association.
 */

/**
 * Marks a chunk frame. A whole (unframed) message is `JSON.stringify` output and
 * therefore always starts with `{`, so the two are never ambiguous, and a peer
 * running an older build still reads every message that fits unframed.
 */
const CHUNK_FRAME_PREFIX = 'sdaw-chunk:';

/**
 * Bytes set aside for a chunk frame's ASCII header. The header is
 * `sdaw-chunk:<messageId>:<index>:<count>:` — 11 prefix bytes, a bounded id,
 * three separators and two decimal counters. Reserving a fixed budget lets the
 * payload be sliced before the frame count is known, and
 * {@link encodeChunkFrame} refuses to emit a header that outgrows it.
 */
const CHUNK_FRAME_HEADER_BYTES = 64;

/** RFC 8831 §6.6 — the message-size ceiling to respect absent RFC 8260 interleaving. */
const INTERLEAVING_SAFE_MESSAGE_BYTES = 16 * 1024;

/**
 * RFC 8841 §6.1 / W3C WebRTC §6.1.1.2 — the value to assume when the peer
 * advertised no `max-message-size`. Used only when the runtime exposes no
 * `RTCSctpTransport` at all (no negotiated association to read).
 */
const DEFAULT_MAX_MESSAGE_BYTES = 65_536;

/** Refuse to reassemble a message beyond this size — an inbound frame stream is untrusted. */
const MAX_REASSEMBLED_BYTES = 64 * 1024 * 1024;

/** Refuse to track more than this many half-delivered messages at once. */
const MAX_PENDING_MESSAGES = 8;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type ChunkFrame = {
    messageId: string;
    index: number;
    count: number;
    payload: string;
};

/**
 * The per-frame byte ceiling for one association.
 *
 * @param negotiatedMaxMessageSize `RTCSctpTransport.maxMessageSize`, or
 *   `undefined` when no SCTP transport exists yet. Per W3C WebRTC §6.1.1.2 the
 *   value may be `+Infinity` (both endpoints accept any size), which the RFC
 *   8831 §6.6 ceiling then bounds.
 */
export function resolveMaxFrameBytes(negotiatedMaxMessageSize: number | undefined): number {
    const negotiated =
        typeof negotiatedMaxMessageSize === 'number' &&
        negotiatedMaxMessageSize > 0 &&
        !Number.isNaN(negotiatedMaxMessageSize)
            ? negotiatedMaxMessageSize
            : DEFAULT_MAX_MESSAGE_BYTES;
    return Math.min(negotiated, INTERLEAVING_SAFE_MESSAGE_BYTES);
}

/** UTF-8 byte length — the unit `send()` measures a payload in, not string length. */
export function utf8ByteLength(text: string): number {
    return encoder.encode(text).length;
}

function encodeChunkFrame(frame: ChunkFrame): string {
    const header = `${CHUNK_FRAME_PREFIX}${frame.messageId}:${frame.index}:${frame.count}:`;
    if (header.length > CHUNK_FRAME_HEADER_BYTES) {
        throw new Error(
            `Chunk frame header of ${header.length} bytes exceeds the ${CHUNK_FRAME_HEADER_BYTES}-byte reserve`
        );
    }
    return `${header}${frame.payload}`;
}

/**
 * Slice `text` so that every piece encodes to at most `maxBytes` UTF-8 bytes.
 *
 * Cuts are moved back off UTF-8 continuation bytes, so no piece ever contains a
 * partial code point and concatenating the pieces reproduces `text` exactly.
 */
function sliceByUtf8Bytes(text: string, maxBytes: number): string[] {
    const bytes = encoder.encode(text);
    const pieces: string[] = [];
    let start = 0;

    while (start < bytes.length) {
        let end = Math.min(start + maxBytes, bytes.length);
        while (end < bytes.length && (bytes[end]! & 0b1100_0000) === 0b1000_0000) {
            end -= 1;
        }
        if (end <= start) {
            throw new Error(`Cannot split a message into frames of ${maxBytes} bytes`);
        }
        pieces.push(decoder.decode(bytes.subarray(start, end)));
        start = end;
    }

    return pieces;
}

type SplitMessageIntoFramesInput = {
    /** The serialized message. */
    text: string;
    /** The per-frame ceiling from {@link resolveMaxFrameBytes}. */
    maxFrameBytes: number;
    /** Identifier carried by every frame of this message; must contain no `:`. */
    messageId: string;
};

type SplitMessageIntoFramesOutput = string[];

/**
 * The wire strings to hand to `send()`, in order.
 *
 * A message that already fits is returned unframed, so the common case costs
 * nothing and stays readable by a peer that does not know this framing.
 */
export function splitMessageIntoFrames({
    text,
    maxFrameBytes,
    messageId,
}: SplitMessageIntoFramesInput): SplitMessageIntoFramesOutput {
    if (utf8ByteLength(text) <= maxFrameBytes) {
        return [text];
    }

    const payloadBytes = maxFrameBytes - CHUNK_FRAME_HEADER_BYTES;
    if (payloadBytes < 4) {
        throw new Error(`Negotiated message size of ${maxFrameBytes} bytes leaves no room for a chunk frame header`);
    }
    if (messageId.includes(':')) {
        throw new Error('A chunk message id must not contain ":"');
    }

    const payloads = sliceByUtf8Bytes(text, payloadBytes);
    return payloads.map((payload, index) => encodeChunkFrame({ messageId, index, count: payloads.length, payload }));
}

/** Read a wire string as a chunk frame, or `null` when it is a whole message. */
export function parseChunkFrame(data: string): ChunkFrame | null {
    if (!data.startsWith(CHUNK_FRAME_PREFIX)) {
        return null;
    }

    const body = data.slice(CHUNK_FRAME_PREFIX.length);
    const idEnd = body.indexOf(':');
    if (idEnd <= 0) {
        return null;
    }
    const indexEnd = body.indexOf(':', idEnd + 1);
    if (indexEnd < 0) {
        return null;
    }
    const countEnd = body.indexOf(':', indexEnd + 1);
    if (countEnd < 0) {
        return null;
    }

    const index = Number(body.slice(idEnd + 1, indexEnd));
    const count = Number(body.slice(indexEnd + 1, countEnd));
    if (!Number.isInteger(index) || !Number.isInteger(count)) {
        return null;
    }
    if (count < 1 || index < 0 || index >= count) {
        return null;
    }

    return {
        messageId: body.slice(0, idEnd),
        index,
        count,
        payload: body.slice(countEnd + 1),
    };
}

type PendingMessage = {
    count: number;
    /** Next index expected. The CRDT channel is reliable and ordered, so frames arrive in order. */
    nextIndex: number;
    payloads: string[];
    bytes: number;
};

/**
 * Rebuilds messages split by {@link splitMessageIntoFrames}.
 *
 * Every bound here exists because the frame stream is remote input: a peer can
 * declare any frame count, stop halfway, or start an unbounded number of
 * messages. Exceeding a bound drops the partial message rather than growing.
 */
export class ChunkAssembler {
    private pending = new Map<string, PendingMessage>();

    /** Feed one frame; returns the complete message text once the last frame lands. */
    accept(frame: ChunkFrame): string | null {
        if (frame.count === 1) {
            return frame.payload;
        }

        let entry = this.pending.get(frame.messageId);
        if (!entry) {
            if (frame.index !== 0) {
                // A continuation for a message we are not tracking (already
                // dropped, or the sender skipped the start).
                return null;
            }
            if (this.pending.size >= MAX_PENDING_MESSAGES) {
                this.pending.clear();
            }
            entry = { count: frame.count, nextIndex: 0, payloads: [], bytes: 0 };
            this.pending.set(frame.messageId, entry);
        }

        if (frame.count !== entry.count || frame.index !== entry.nextIndex) {
            this.pending.delete(frame.messageId);
            return null;
        }

        const frameBytes = utf8ByteLength(frame.payload);
        if (entry.bytes + frameBytes > MAX_REASSEMBLED_BYTES) {
            this.pending.delete(frame.messageId);
            return null;
        }

        entry.payloads.push(frame.payload);
        entry.bytes += frameBytes;
        entry.nextIndex += 1;

        if (entry.nextIndex < entry.count) {
            return null;
        }

        this.pending.delete(frame.messageId);
        return entry.payloads.join('');
    }

    /** Drop every half-delivered message (channel closed or peer removed). */
    clear(): void {
        this.pending.clear();
    }
}
