import { vi } from 'vitest';

// Shared test harness for the WASM-view lifecycle specs (audit RT-1 / RT-7).
//
// Every converted processor caches `Float32Array` views over WASM linear memory
// and must (a) allocate no such view in steady state and (b) rebuild its views
// over the post-grow buffer when a `memory.grow()` detaches the old `ArrayBuffer`
// mid-`process()`. These helpers factor out the mutable-buffer mock plumbing so
// each processor spec only declares its own device-specific instance mock.
//
// The mutable `memory` object is referenced inside each spec's hoisted `vi.mock`
// factory, but that factory is only invoked at lazy-import time (the specs
// `await import(...)` the processor inside the test), by which point this module
// and the spec's top-level `memory` are fully initialized — so there is no
// temporal-dead-zone hazard.

export const RealFloat32Array = globalThis.Float32Array;

export type GrowableMemory = { buffer: ArrayBuffer };

/** A fake `WebAssembly.Memory`-like object whose buffer can be swapped to model growth. */
export function createGrowableMemory(byteLength: number): GrowableMemory {
    return { buffer: new RealFloat32Array(byteLength).buffer };
}

/** Reset a growable memory to a fresh, non-detached buffer (call in `beforeEach`). */
export function resetGrowableMemory(memory: GrowableMemory, byteLength: number): void {
    memory.buffer = new RealFloat32Array(byteLength).buffer;
}

export type ViewCounter = {
    /** Drop-in `Float32Array` replacement that counts views mapped over `memory.buffer`. */
    CountingFloat32Array: typeof Float32Array;
    reset(): void;
    count(): number;
};

/**
 * Build a counting `Float32Array` subclass bound to `memory`. It counts only
 * constructions that map the live WASM heap (arg0 === `memory.buffer`); scratch
 * arrays built from a length, and views over other buffers (SAB telemetry), are
 * deliberately excluded.
 */
export function createViewCounter(memory: GrowableMemory): ViewCounter {
    let count = 0;
    class CountingFloat32Array extends RealFloat32Array {
        constructor(bufferOrLength: ArrayBuffer | number, byteOffset?: number, length?: number) {
            if (typeof bufferOrLength === 'number') {
                super(bufferOrLength);
                return;
            }
            super(bufferOrLength, byteOffset, length);
            if (bufferOrLength === memory.buffer) {
                count++;
            }
        }
    }
    return {
        CountingFloat32Array: CountingFloat32Array as unknown as typeof Float32Array,
        reset() {
            count = 0;
        },
        count() {
            return count;
        },
    };
}

/**
 * Swap the global `Float32Array` for the counting subclass, run `run` (the blocks
 * under measurement), restore the real constructor, and return the count of views
 * minted over WASM memory during `run`.
 */
export function measureWasmViewAllocations(counter: ViewCounter, run: () => void): number {
    vi.stubGlobal('Float32Array', counter.CountingFloat32Array);
    counter.reset();
    try {
        run();
    } finally {
        vi.stubGlobal('Float32Array', RealFloat32Array);
    }
    return counter.count();
}

/**
 * Build a counting `Float32Array` subclass that counts **every** construction,
 * length-form scratch arrays included.
 *
 * `createViewCounter` deliberately ignores those, because RT-1/RT-7 are about
 * views mapped over WASM linear memory. RT-3 is the stricter invariant — a
 * steady-state `process()` must allocate nothing at all — so proving it needs a
 * counter that sees `new Float32Array(128)`, which is exactly the allocation the
 * Fermenter scope buffer used to make on the render thread every ~46 ms.
 */
export function createTotalViewCounter(): ViewCounter {
    let count = 0;
    class CountingFloat32Array extends RealFloat32Array {
        constructor(bufferOrLength: ArrayBuffer | number, byteOffset?: number, length?: number) {
            if (typeof bufferOrLength === 'number') {
                super(bufferOrLength);
            } else {
                super(bufferOrLength, byteOffset, length);
            }
            count++;
        }
    }
    return {
        CountingFloat32Array: CountingFloat32Array as unknown as typeof Float32Array,
        reset() {
            count = 0;
        },
        count() {
            return count;
        },
    };
}

/** The same stub-measure-restore harness, named for the total-allocation counter. */
export const measureAllocations = measureWasmViewAllocations;

export type RampSeed = { ptr: number; length: number; base: number };

/**
 * Model a WASM `memory.grow()` that fires *inside* a `process()` call: detach the
 * current buffer (via `ArrayBuffer.prototype.transfer`), install a fresh one, and
 * seed each named window of the NEW buffer with a recognizable ascending ramp
 * (`base, base+1, …`). A processor that maps its views over the post-grow buffer
 * reads these ramps back; one that reuses a pre-call buffer reference reads a
 * detached, zero-length view (NaN / silence) or faults.
 */
export function growAndSeedRamps(memory: GrowableMemory, byteLength: number, seeds: readonly RampSeed[]): void {
    const grown = memory.buffer.transfer(byteLength);
    memory.buffer = grown;
    for (const seed of seeds) {
        const view = new RealFloat32Array(grown, seed.ptr, seed.length);
        for (let index = 0; index < seed.length; index++) {
            view[index] = seed.base + index;
        }
    }
}

/** The expected ramp array a seeded window should read back as. */
export function ramp(length: number, base: number): number[] {
    return Array.from({ length }, (_unused, index) => base + index);
}

export type WorkletGlobals<TProcessor> = {
    registry: Map<string, new (...args: unknown[]) => TProcessor>;
};

/**
 * Install the AudioWorklet global shims the processor modules expect
 * (`AudioWorkletProcessor`, `registerProcessor`, `sampleRate`, `currentFrame`)
 * and return the registry that `registerProcessor` populates.
 */
export function installWorkletGlobals<TProcessor>(): WorkletGlobals<TProcessor> {
    const registry = new Map<string, new (...args: unknown[]) => TProcessor>();
    class AudioWorkletProcessorShim {
        port = {
            onmessage: null as ((event: { data: unknown }) => void) | null,
            postMessage: vi.fn(),
        };
    }
    vi.stubGlobal('AudioWorkletProcessor', AudioWorkletProcessorShim);
    vi.stubGlobal('registerProcessor', (name: string, proc: new (...args: unknown[]) => TProcessor) => {
        registry.set(name, proc);
    });
    vi.stubGlobal('sampleRate', 48000);
    vi.stubGlobal('currentFrame', 0);
    return { registry };
}

/** Build `count` channel buffers of `frames` samples, each filled by `fill(channel, frame)`. */
export function makeChannels(
    count: number,
    frames: number,
    fill: (channel: number, frame: number) => number = () => 0
): Float32Array[] {
    return Array.from({ length: count }, (_unused, channel) => {
        const buffer = new RealFloat32Array(frames);
        for (let frame = 0; frame < frames; frame++) {
            buffer[frame] = fill(channel, frame);
        }
        return buffer;
    });
}
