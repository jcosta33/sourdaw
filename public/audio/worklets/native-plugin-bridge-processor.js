/**
 * Native Plugin Bridge Processor — relays audio between the Web Audio graph and
 * the Rust plugin host.
 *
 * The plugin lives in another process, so the audio has to leave this agent
 * cluster. A SharedArrayBuffer cannot: it is shareable only among JS agents
 * (main thread, workers, worklets), there is no supported way to map its backing
 * store into native code, and on macOS the webview content runs in its own
 * process anyway. So the transport is a MessagePort hop to the main thread,
 * which forwards to Rust. `postMessage` allocates by definition — this relay
 * cannot be made allocation-free, and no amount of ring-buffer design here
 * changes that.
 *
 * What it does avoid, all of which used to happen on every single render
 * quantum:
 *
 * - a fresh `new Uint8Array(frames * 8)` payload (~1 KB of backing store),
 * - a `DataView` plus a per-sample `setFloat32` loop (~1000 calls),
 * - on the return leg, another `Uint8Array`, another `DataView`, and two more
 *   `Float32Array` allocations, plus a second per-sample loop.
 *
 * Instead a fixed pool of transfer buffers cycles worklet → main → worklet, and
 * conversion writes through one typed-array view. Transferring detaches the
 * buffer, so views cannot be cached across the hop; re-wrapping costs one small
 * view object, not a kilobyte.
 *
 * A block that cannot be sent — every pooled buffer still in flight — is counted
 * in the shared dropout tally rather than disappearing. The output is not
 * zero-filled for this: the previously processed block plays again, which is far
 * less audible than punching a hole, and the count is what makes the event
 * visible.
 *
 * Latency: one audio block (128 samples ≈ 2.67 ms at 48 kHz). The worklet reads
 * the previous block's output while sending the current input.
 */

const BYTES_PER_FRAME = 8; // f32 left + f32 right
const MAX_QUANTUM_FRAMES = 128;
const TRANSFER_POOL_SIZE = 4;

/** Mirrors `DROPOUT_IDX` in engine/dropoutCounter.ts. Worklets import nothing. */
const BRIDGE_DROPPED_BLOCKS_INDEX = 3;

/**
 * The wire format is explicitly little-endian, because the Rust side reads it
 * with `f32::from_le_bytes`. A `Float32Array` writes native byte order, which
 * matches on every platform this ships to — but "every platform we ship to" is
 * not "every platform", so the cheap path is taken only once that is confirmed
 * and the byte-exact path stays for anything else. Checked once, at
 * construction, never per block.
 */
function detectLittleEndian() {
    const probe = new ArrayBuffer(4);
    new DataView(probe).setFloat32(0, 1.5, true);
    return new Float32Array(probe)[0] === 1.5;
}

function passThrough(input, output) {
    for (let channel = 0; channel < input.length && channel < output.length; channel++) {
        output[channel].set(input[channel]);
    }
}

class NativePluginBridgeProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.ready = false;
        this.littleEndian = detectLittleEndian();
        this.dropoutCounters = null;

        // Decoded output of the most recent completed round trip.
        this.outputLeft = new Float32Array(MAX_QUANTUM_FRAMES);
        this.outputRight = new Float32Array(MAX_QUANTUM_FRAMES);
        this.outputFrames = 0;

        // Transfer buffers not currently in flight. Sized once; never grown.
        this.freeBuffers = [];
        for (let index = 0; index < TRANSFER_POOL_SIZE; index++) {
            this.freeBuffers.push(new ArrayBuffer(MAX_QUANTUM_FRAMES * BYTES_PER_FRAME));
        }

        this.port.onmessage = (event) => {
            const message = event.data;

            if (message.type === 'init') {
                // No plugin identity here: the main-thread relay resolves the
                // instance. The worklet only needs to know it may start.
                if (message.dropoutSab) {
                    this.dropoutCounters = new Int32Array(message.dropoutSab);
                }
                this.ready = true;
                return;
            }

            if (message.type === 'processed') {
                this.decodeOutput(message.audio);
                this.recycle(message.audio);
                return;
            }

            if (message.type === 'recycle') {
                // Round trip ended without usable audio (relay error, or a block
                // the relay dropped). Reclaim the buffer so the pool stays whole.
                this.recycle(message.audio);
            }
        };
    }

    recycle(buffer) {
        if (buffer && buffer.byteLength > 0 && this.freeBuffers.length < TRANSFER_POOL_SIZE) {
            this.freeBuffers.push(buffer);
        }
    }

    countDroppedBlock() {
        if (this.dropoutCounters) {
            Atomics.add(this.dropoutCounters, BRIDGE_DROPPED_BLOCKS_INDEX, 1);
        }
    }

    /** Deinterleave the relay's reply into the preallocated output buffers. */
    decodeOutput(buffer) {
        if (!buffer || buffer.byteLength === 0) {
            return;
        }

        const frames = Math.min(buffer.byteLength / BYTES_PER_FRAME, MAX_QUANTUM_FRAMES);

        if (this.littleEndian) {
            const pairs = new Float32Array(buffer);
            for (let frame = 0; frame < frames; frame++) {
                this.outputLeft[frame] = pairs[frame * 2];
                this.outputRight[frame] = pairs[frame * 2 + 1];
            }
        } else {
            const view = new DataView(buffer);
            for (let frame = 0; frame < frames; frame++) {
                this.outputLeft[frame] = view.getFloat32(frame * BYTES_PER_FRAME, true);
                this.outputRight[frame] = view.getFloat32(frame * BYTES_PER_FRAME + 4, true);
            }
        }

        this.outputFrames = frames;
    }

    /** Interleave the current input into a pooled buffer and hand it off. */
    sendInput(left, right, frames) {
        const buffer = this.freeBuffers.pop();
        if (!buffer) {
            // Every pooled buffer is still in flight: the relay is behind the
            // render thread. Drop this block rather than allocate here.
            this.countDroppedBlock();
            return;
        }

        if (this.littleEndian) {
            const pairs = new Float32Array(buffer);
            for (let frame = 0; frame < frames; frame++) {
                pairs[frame * 2] = left[frame];
                pairs[frame * 2 + 1] = right[frame];
            }
        } else {
            const view = new DataView(buffer);
            for (let frame = 0; frame < frames; frame++) {
                view.setFloat32(frame * BYTES_PER_FRAME, left[frame], true);
                view.setFloat32(frame * BYTES_PER_FRAME + 4, right[frame], true);
            }
        }

        this.port.postMessage({ type: 'process', audio: buffer }, [buffer]);
    }

    process(inputs, outputs) {
        const input = inputs[0];
        const output = outputs[0];
        if (!input || !output || input.length < 1) {
            return true;
        }

        const frames = Math.min(input[0].length, MAX_QUANTUM_FRAMES);

        if (!this.ready) {
            passThrough(input, output);
            return true;
        }

        // Write the PREVIOUS block's processed output. Before the first reply —
        // and while blocks are being dropped — the dry signal is the honest
        // fallback: silence here would be a click the plugin never asked for.
        if (this.outputFrames >= frames) {
            output[0].set(this.outputLeft.subarray(0, frames));
            if (output[1]) {
                output[1].set(this.outputRight.subarray(0, frames));
            }
        } else {
            passThrough(input, output);
        }

        this.sendInput(input[0], input[1] ?? input[0], frames);

        return true;
    }
}

registerProcessor('native-plugin-bridge-processor', NativePluginBridgeProcessor);
