import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The native plugin bridge worklet, exercised directly.
 *
 * The relay cannot be made allocation-free: audio has to reach a Rust process,
 * a `SharedArrayBuffer` is shareable only among JS agents in one agent cluster,
 * and on macOS the webview content runs in its own process — so a MessagePort
 * hop is the only transport available, and `postMessage` allocates by
 * definition. What *is* achievable is that `process()` stops allocating the
 * payload: a fixed pool of transfer buffers cycles worklet → main → worklet,
 * sample conversion is two bulk copies instead of a thousand `DataView` writes,
 * and a block that cannot be sent is counted rather than vanishing.
 *
 * These specs drive the real processor: the worklet file is imported with the
 * `AudioWorkletGlobalScope` globals stubbed, and the class it registers is
 * captured and instantiated.
 */

type BridgeMessage = {
    audio?: ArrayBuffer;
    dropoutSab?: SharedArrayBuffer | null;
    type: string;
};

type ProcessorInstance = {
    port: FakePort;
    process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean;
};

class FakePort {
    public onmessage: ((event: { data: BridgeMessage }) => void) | null = null;
    public readonly posted: { message: BridgeMessage; transfer: ArrayBuffer[] }[] = [];

    public postMessage(message: BridgeMessage, transfer: ArrayBuffer[] = []): void {
        this.posted.push({ message, transfer });
    }

    public deliver(message: BridgeMessage): void {
        this.onmessage?.({ data: message });
    }
}

/** Slot the bridge bumps for a block it could not send. Mirrors `DROPOUT_IDX`. */
const BRIDGE_DROPPED_BLOCKS_INDEX = 3;
const QUANTUM = 128;
/** Mirrors `TRANSFER_POOL_SIZE` in the worklet. Grow both together. */
const TRANSFER_POOL_SIZE = 4;

let ProcessorClass: new () => ProcessorInstance;

async function loadProcessor(): Promise<void> {
    const registered: Record<string, new () => ProcessorInstance> = {};

    class FakeAudioWorkletProcessor {
        public readonly port = new FakePort();
    }

    vi.stubGlobal('AudioWorkletProcessor', FakeAudioWorkletProcessor);
    vi.stubGlobal('sampleRate', 48_000);
    vi.stubGlobal('currentFrame', 0);
    vi.stubGlobal('registerProcessor', (name: string, processor: new () => ProcessorInstance) => {
        registered[name] = processor;
    });

    vi.resetModules();
    await import('../../../../../public/audio/worklets/native-plugin-bridge-processor.js');

    const found = registered['native-plugin-bridge-processor'];
    if (!found) {
        throw new Error('worklet file did not register native-plugin-bridge-processor');
    }
    ProcessorClass = found;
}

function ramp(length: number, start: number): Float32Array {
    const values = new Float32Array(length);
    for (let index = 0; index < length; index++) {
        values[index] = (start + index) / 1000;
    }
    return values;
}

function stereoBlock(seed: number): Float32Array[] {
    return [ramp(QUANTUM, seed), ramp(QUANTUM, seed + 500)];
}

/** One render quantum of silence, in the shape `Array.from` reads a channel as. */
function silentQuantum(): number[] {
    return Array.from({ length: QUANTUM }, () => 0);
}

/**
 * An output buffer still holding the previous quantum, which is what a real host
 * hands `process()`. A node that writes nothing leaves this sounding, and a
 * zeroed buffer cannot tell that apart from silence written on purpose.
 */
function recycledOutput(): Float32Array[] {
    return [ramp(QUANTUM, 7000), ramp(QUANTUM, 7500)];
}

function emptyOutput(): Float32Array[] {
    return [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
}

/**
 * What the spec hands a node whose upstream is not actively processing: an
 * input of zero channels, which is how an empty track or an ended clip arrives.
 */
function inactiveInput(): Float32Array[] {
    return [];
}

/** Interleaved [L0,R0,L1,R1,…] little-endian f32 pairs, as the Rust side reads them. */
function decodeInterleaved(buffer: ArrayBuffer): { left: number[]; right: number[] } {
    const view = new DataView(buffer);
    const left: number[] = [];
    const right: number[] = [];
    for (let frame = 0; frame < buffer.byteLength / 8; frame++) {
        left.push(view.getFloat32(frame * 8, true));
        right.push(view.getFloat32(frame * 8 + 4, true));
    }
    return { left, right };
}

function encodeInterleaved(left: Float32Array, right: Float32Array): ArrayBuffer {
    const buffer = new ArrayBuffer(left.length * 8);
    const view = new DataView(buffer);
    for (let frame = 0; frame < left.length; frame++) {
        view.setFloat32(frame * 8, left[frame]!, true);
        view.setFloat32(frame * 8 + 4, right[frame]!, true);
    }
    return buffer;
}

function lastSentBuffer(port: FakePort): ArrayBuffer {
    const sent = port.posted.filter((entry) => entry.message.type === 'process');
    const latest = sent.at(-1);
    if (!latest?.message.audio) {
        throw new Error('expected the processor to have sent an audio block');
    }
    return latest.message.audio;
}

describe('native plugin bridge worklet', () => {
    beforeEach(async () => {
        await loadProcessor();
    });

    it('passes the dry signal through until the relay says it may start', () => {
        const processor = new ProcessorClass();
        const input = stereoBlock(1);
        const output = emptyOutput();

        processor.process([input], [output]);

        expect(Array.from(output[0]!)).toEqual(Array.from(input[0]!));
        expect(Array.from(output[1]!)).toEqual(Array.from(input[1]!));
        expect(processor.port.posted).toHaveLength(0);
    });

    /**
     * The relay is running and nothing has come back yet, so this quantum has no
     * processed audio. Handing the dry input back makes the under-run audible as
     * the unprocessed source at full level — a chain heard as a filter or a
     * distortion briefly plays the raw signal. The Rust relay answers an empty
     * ring with silence for the same reason (ADR 0021).
     *
     * The output buffer is pre-filled, because a real host recycles the one it
     * hands `process()`: a node that writes nothing leaves the previous quantum
     * sounding, and an already-zeroed buffer would read as silence either way.
     */
    it('emits silence rather than the dry input until the first processed block arrives', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });
        const output = recycledOutput();

        processor.process([stereoBlock(1)], [output]);

        expect(Array.from(output[0]!)).toEqual(silentQuantum());
        expect(Array.from(output[1]!)).toEqual(silentQuantum());
        expect(lastSentBuffer(processor.port).byteLength).toBe(QUANTUM * 8);
    });

    it('sends the current block as interleaved little-endian pairs', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });
        const input = stereoBlock(1);

        processor.process([input], [emptyOutput()]);

        const decoded = decodeInterleaved(lastSentBuffer(processor.port));
        expect(decoded.left).toEqual(Array.from(input[0]!));
        expect(decoded.right).toEqual(Array.from(input[1]!));
    });

    it('plays back the processed block the relay returned, not the dry input', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });
        const input = stereoBlock(1);
        processor.process([input], [emptyOutput()]);

        const wetLeft = ramp(QUANTUM, 9000);
        const wetRight = ramp(QUANTUM, 9500);
        processor.port.deliver({ type: 'processed', audio: encodeInterleaved(wetLeft, wetRight) });

        const output = emptyOutput();
        processor.process([stereoBlock(2)], [output]);

        expect(Array.from(output[0]!)).toEqual(Array.from(wetLeft));
        expect(Array.from(output[1]!)).toEqual(Array.from(wetRight));
    });

    it('reuses its transfer buffers instead of allocating one per render quantum', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });

        processor.process([stereoBlock(1)], [emptyOutput()]);
        const firstBuffer = lastSentBuffer(processor.port);

        // The relay hands the same backing store back once the round trip ends.
        processor.port.deliver({ type: 'recycle', audio: firstBuffer });
        processor.process([stereoBlock(2)], [emptyOutput()]);

        expect(lastSentBuffer(processor.port)).toBe(firstBuffer);
    });

    it('counts a block it cannot send once every transfer buffer is in flight', () => {
        const dropoutSab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
        const counters = new Int32Array(dropoutSab);
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init', dropoutSab });

        // Never recycle, so the pool drains and then stays empty.
        let sentBlocks = 0;
        for (let block = 0; block < 40; block++) {
            processor.process([stereoBlock(block)], [emptyOutput()]);
            sentBlocks = processor.port.posted.filter((entry) => entry.message.type === 'process').length;
        }

        // Exactly the pool depth goes out — four buffers, none ever returned —
        // and every subsequent block is counted. Pinning the number rather than
        // bounding it is what makes a larger or unbounded pool fail here.
        expect(sentBlocks).toBe(TRANSFER_POOL_SIZE);
        expect(Atomics.load(counters, BRIDGE_DROPPED_BLOCKS_INDEX)).toBe(40 - TRANSFER_POOL_SIZE);
    });

    /**
     * A decoded block belongs to the one quantum it is written to. Keeping it
     * for the next under-run replays a 2.7 ms fragment for as long as the relay
     * stays behind — a buzz at the render rate — and, worse, it hides the
     * under-run behind audio that sounds plausible.
     */
    it('under-runs into silence after a processed block rather than replaying it', () => {
        const dropoutSab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init', dropoutSab });

        const wetLeft = ramp(QUANTUM, 4000);
        const wetRight = ramp(QUANTUM, 4500);
        processor.process([stereoBlock(1)], [emptyOutput()]);
        processor.port.deliver({ type: 'processed', audio: encodeInterleaved(wetLeft, wetRight) });

        const played = emptyOutput();
        processor.process([stereoBlock(2)], [played]);
        expect(Array.from(played[0]!)).toEqual(Array.from(wetLeft));
        expect(Array.from(played[1]!)).toEqual(Array.from(wetRight));

        // Nothing came back for this one, and the block above has been played.
        const starved = recycledOutput();
        processor.process([stereoBlock(3)], [starved]);

        expect(Array.from(starved[0]!)).toEqual(silentQuantum());
        expect(Array.from(starved[1]!)).toEqual(silentQuantum());
    });

    /**
     * An inactive input is silence, not a reason to stop rendering. Every DAW
     * keeps an insert running while the engine runs, because a reverb or delay
     * tail has to decay past the clip that fed it and a generator plugin has no
     * input to wait for. A skipped quantum is a plugin that is never asked to
     * render at all.
     */
    it('renders a silent block when its input has no active channels', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });
        const output = emptyOutput();

        processor.process([inactiveInput()], [output]);

        const sent = processor.port.posted.filter((entry) => entry.message.type === 'process');
        expect(sent).toHaveLength(1);

        const decoded = decodeInterleaved(lastSentBuffer(processor.port));
        expect(decoded.left).toEqual(silentQuantum());
        expect(decoded.right).toEqual(silentQuantum());
    });

    it('plays the processed block back even when the input is inactive', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });
        processor.process([inactiveInput()], [emptyOutput()]);

        const wetLeft = ramp(QUANTUM, 2000);
        const wetRight = ramp(QUANTUM, 2500);
        processor.port.deliver({ type: 'processed', audio: encodeInterleaved(wetLeft, wetRight) });

        const output = emptyOutput();
        processor.process([inactiveInput()], [output]);

        expect(Array.from(output[0]!)).toEqual(Array.from(wetLeft));
        expect(Array.from(output[1]!)).toEqual(Array.from(wetRight));
    });

    it('outputs silence, not stale data, for an inactive input before the relay is ready', () => {
        const processor = new ProcessorClass();
        const output = recycledOutput();

        processor.process([inactiveInput()], [output]);

        expect(Array.from(output[0]!)).toEqual(silentQuantum());
        expect(Array.from(output[1]!)).toEqual(silentQuantum());
        expect(processor.port.posted).toHaveLength(0);
    });

    it('allocates nothing per quantum for an inactive input', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });

        processor.process([inactiveInput()], [emptyOutput()]);
        const firstBuffer = lastSentBuffer(processor.port);

        // The relay hands the same backing store back once the round trip ends.
        processor.port.deliver({ type: 'recycle', audio: firstBuffer });
        processor.process([inactiveInput()], [emptyOutput()]);

        expect(lastSentBuffer(processor.port)).toBe(firstBuffer);
    });

    it('transfers the payload rather than copying it across the port', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });

        processor.process([stereoBlock(1)], [emptyOutput()]);

        const sent = processor.port.posted.find((entry) => entry.message.type === 'process');
        expect(sent?.transfer).toEqual([sent?.message.audio]);
    });
});
