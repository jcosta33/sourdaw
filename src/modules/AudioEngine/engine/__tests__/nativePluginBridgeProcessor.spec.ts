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

function emptyOutput(): Float32Array[] {
    return [new Float32Array(QUANTUM), new Float32Array(QUANTUM)];
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

    it('keeps emitting the last processed block while blocks are being dropped', () => {
        const dropoutSab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init', dropoutSab });

        const wetLeft = ramp(QUANTUM, 4000);
        const wetRight = ramp(QUANTUM, 4500);
        processor.process([stereoBlock(1)], [emptyOutput()]);
        processor.port.deliver({ type: 'processed', audio: encodeInterleaved(wetLeft, wetRight) });

        // Drain the pool without ever recycling, then render one more block.
        for (let block = 0; block < 20; block++) {
            processor.process([stereoBlock(block)], [emptyOutput()]);
        }
        const output = emptyOutput();
        processor.process([stereoBlock(99)], [output]);

        expect(Array.from(output[0]!)).toEqual(Array.from(wetLeft));
    });

    it('transfers the payload rather than copying it across the port', () => {
        const processor = new ProcessorClass();
        processor.port.deliver({ type: 'init' });

        processor.process([stereoBlock(1)], [emptyOutput()]);

        const sent = processor.port.posted.find((entry) => entry.message.type === 'process');
        expect(sent?.transfer).toEqual([sent?.message.audio]);
    });
});
