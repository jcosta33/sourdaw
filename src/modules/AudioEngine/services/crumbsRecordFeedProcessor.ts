/**
 * Crumbs Record Feed Processor — taps the monitored input bus for the native
 * sampler's record bridge.
 *
 * Runs inside an AudioWorkletGlobalScope and imports nothing from the app:
 * like the native plugin bridge processor, its only channel is the
 * MessagePort, and the main-thread side of this protocol
 * (`CrumbsRecordFeedNode`) is what talks IPC. The block leaves as interleaved
 * little-endian f32 bytes (L0,R0,L1,R1,...) — the same wire format
 * `process_plugin_audio` accepts — and the Rust record feed pushes it into
 * every armed crumbs bridge.
 *
 * Gating mirrors the plugin relay: the processor exists for the whole session
 * but posts nothing until the main thread arms it, and stops the moment it is
 * disarmed, so an idle app pays no per-quantum round trip at all. A block
 * that cannot be sent — every pooled buffer still in flight — is a hole in
 * the take, not a dropped frame of monitoring, so it is counted and reported
 * with the next message that does go out.
 *
 * Port protocol:
 *   ← { type: 'arm' }                                begin posting blocks
 *   ← { type: 'disarm' }                             stop posting blocks
 *   ← { type: 'recycle', audio: ArrayBuffer }        return a spent buffer
 *   → { type: 'feed', audio: ArrayBuffer, dropped }  one interleaved block
 *     plus the count of blocks dropped since the previous message
 */

const BYTES_PER_FRAME = 8; // f32 left + f32 right
const MAX_QUANTUM_FRAMES = 128;
const TRANSFER_POOL_SIZE = 4;

type FeedMsg = { type: 'arm' } | { type: 'disarm' } | { type: 'recycle'; audio: ArrayBuffer };

/**
 * The wire format is explicitly little-endian, because the Rust side reads it
 * with `f32::from_le_bytes`. A `Float32Array` writes native byte order, which
 * matches on every platform this ships to — checked once, at construction,
 * never per block (the idiom the native plugin bridge processor established).
 */
function detectLittleEndian(): boolean {
    const probe = new ArrayBuffer(4);
    new DataView(probe).setFloat32(0, 1.5, true);
    return new Float32Array(probe)[0] === 1.5;
}

/**
 * Interleave one stereo block into a byte buffer as little-endian f32.
 *
 * Pure and exported for the spec: the byte layout is the contract the Rust
 * record feed parses, so it is pinned by test rather than by re-reading two
 * files that must agree. Writes at most `left.length` frames; a short block
 * is never padded, matching the Rust side's "the frame count travels with
 * the block" rule.
 */
export function interleaveBlock(
    bytes: Uint8Array,
    left: Float32Array,
    right: Float32Array,
    littleEndian: boolean
): number {
    const frames = Math.min(left.length, right.length, bytes.byteLength / BYTES_PER_FRAME);
    if (littleEndian) {
        const view = new Float32Array(bytes.buffer, bytes.byteOffset, frames * 2);
        for (let frame = 0; frame < frames; frame++) {
            view[frame * 2] = left[frame] ?? 0;
            view[frame * 2 + 1] = right[frame] ?? 0;
        }
        return frames;
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, frames * BYTES_PER_FRAME);
    for (let frame = 0; frame < frames; frame++) {
        view.setFloat32(frame * BYTES_PER_FRAME, left[frame] ?? 0, true);
        view.setFloat32(frame * BYTES_PER_FRAME + 4, right[frame] ?? 0, true);
    }
    return frames;
}

class CrumbsRecordFeedProcessor extends AudioWorkletProcessor {
    private armed = false;
    private readonly littleEndian = detectLittleEndian();
    /** Transfer buffers not currently in flight. Sized once; never grown. */
    private readonly freeBuffers: ArrayBuffer[] = [];
    /** Blocks dropped since the last message that made it out. */
    private droppedSinceLastFeed = 0;

    constructor() {
        super();
        for (let index = 0; index < TRANSFER_POOL_SIZE; index++) {
            this.freeBuffers.push(new ArrayBuffer(MAX_QUANTUM_FRAMES * BYTES_PER_FRAME));
        }
        this.port.onmessage = ({ data }: MessageEvent<FeedMsg>) => {
            switch (data.type) {
                case 'arm':
                    this.armed = true;
                    break;
                case 'disarm':
                    this.armed = false;
                    break;
                case 'recycle':
                    // A recycled buffer is the same pooled object that left;
                    // anything oversized or foreign would corrupt the pool's
                    // fixed capacity assumptions, so only exact fits return.
                    if (data.audio.byteLength === MAX_QUANTUM_FRAMES * BYTES_PER_FRAME) {
                        this.freeBuffers.push(data.audio);
                    }
                    break;
            }
        };
    }

    process(inputs: Float32Array[][]): boolean {
        // Pass-through: the tap sits parallel to the monitored path (into a
        // silent sink that keeps it pulled), so the output is unused — but a
        // pass-through keeps the node insertable inline without doubling or
        // muting anything.
        const input = inputs[0];
        const left = input?.[0];
        if (!this.armed || !left || left.length === 0) {
            return true;
        }
        // A mono source feeds both channels of the record bus.
        const right = input?.[1] ?? left;

        const buffer = this.freeBuffers.pop();
        if (!buffer) {
            // Every pooled buffer is still in flight: the main thread is
            // behind, and this block is a hole in the armed take. Counted,
            // never hidden — the count rides the next message that goes out.
            this.droppedSinceLastFeed++;
            return true;
        }

        const frames = interleaveBlock(new Uint8Array(buffer), left, right, this.littleEndian);
        if (frames === 0) {
            this.freeBuffers.push(buffer);
            return true;
        }
        const dropped = this.droppedSinceLastFeed;
        this.droppedSinceLastFeed = 0;
        if (frames === MAX_QUANTUM_FRAMES) {
            // Full quantum: transfer the pooled buffer (no per-block
            // allocation); it comes back on 'recycle'.
            this.port.postMessage({ type: 'feed', audio: buffer, dropped }, [buffer]);
        } else {
            // Short quantum: post a clone of just the live bytes so the Rust
            // side never parses the stale tail of a recycled buffer, and keep
            // the pooled buffer — the exact-fit check on 'recycle' keeps the
            // clone out of the pool.
            const live = new Uint8Array(buffer, 0, frames * BYTES_PER_FRAME).slice();
            this.port.postMessage({ type: 'feed', audio: live.buffer, dropped });
        }
        return true;
    }
}

registerProcessor('crumbs-record-feed-processor', CrumbsRecordFeedProcessor);
