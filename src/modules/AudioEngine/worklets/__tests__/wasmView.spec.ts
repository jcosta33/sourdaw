import { describe, it, expect } from 'vitest';

import { WasmView } from '../wasmView';

// The WasmView helper is the reviewable carrier of the RT-1/RT-7 invariant:
// "no Float32Array allocation in steady-state process(), and never a view over a
// detached buffer." A `WebAssembly.Memory` is faked with a mutable-buffer holder
// so a `memory.grow()` (which detaches the old ArrayBuffer and installs a new one)
// can be simulated by swapping `buffer`.
type MemoryHolder = { buffer: ArrayBufferLike };

const HEAP_BYTES = 64 * 1024;

function makeMemory(): MemoryHolder {
    return { buffer: new ArrayBuffer(HEAP_BYTES) };
}

// Write a recognizable ramp of `length` floats into `buffer` starting at byte
// `ptr`, so a view over the correct window reads it back exactly.
function writeRamp(buffer: ArrayBufferLike, ptr: number, length: number, base: number): void {
    const scratch = new Float32Array(buffer, ptr, length);
    for (let index = 0; index < length; index++) {
        scratch[index] = base + index;
    }
}

describe('WasmView steady-state reuse (audit RT-1)', () => {
    it('returns the identical view instance when buffer, pointer, and length are unchanged', () => {
        const memory = makeMemory();
        const view = new WasmView();

        const first = view.get(memory.buffer, 0, 128);
        const second = view.get(memory.buffer, 0, 128);
        const third = view.get(memory.buffer, 0, 128);

        // Same object across calls — a fresh `new Float32Array` would break identity,
        // so identity stability *is* the "zero allocation per quantum" proof.
        expect(second).toBe(first);
        expect(third).toBe(first);
    });

    it('reads the live bytes of the backing buffer through the reused view', () => {
        const memory = makeMemory();
        const view = new WasmView();
        const cached = view.get(memory.buffer, 256, 4);

        // Mutating the heap under the cached view is reflected on the next read
        // without rebuilding — the view genuinely maps the memory, it is not a copy.
        writeRamp(memory.buffer, 256, 4, 10);
        const reused = view.get(memory.buffer, 256, 4);

        expect(reused).toBe(cached);
        expect(Array.from(reused)).toEqual([10, 11, 12, 13]);
    });
});

describe('WasmView rebuild triggers (audit RT-1 / RT-7)', () => {
    it('rebuilds and rewindows when the pointer changes', () => {
        const memory = makeMemory();
        writeRamp(memory.buffer, 0, 4, 100);
        writeRamp(memory.buffer, 512, 4, 200);
        const view = new WasmView();

        const atZero = view.get(memory.buffer, 0, 4);
        const atOffset = view.get(memory.buffer, 512, 4);

        expect(atOffset).not.toBe(atZero);
        expect(Array.from(atZero)).toEqual([100, 101, 102, 103]);
        expect(Array.from(atOffset)).toEqual([200, 201, 202, 203]);
    });

    it('rebuilds when the frame count changes', () => {
        const memory = makeMemory();
        const view = new WasmView();

        const small = view.get(memory.buffer, 0, 64);
        const large = view.get(memory.buffer, 0, 128);

        expect(large).not.toBe(small);
        expect(small.length).toBe(64);
        expect(large.length).toBe(128);
    });

    it('rebuilds over the new buffer after a simulated memory.grow() and never hands back a detached view', () => {
        const memory = makeMemory();
        const view = new WasmView();

        // Cache a view over the original buffer, then grow: transfer() detaches the
        // original ArrayBuffer (byteLength 0) and returns a fresh one, exactly like
        // a WASM memory.grow(). The cached view is now over a detached buffer.
        const stale = view.get(memory.buffer, 128, 4);
        const originalBuffer = memory.buffer as ArrayBuffer;
        memory.buffer = originalBuffer.transfer(HEAP_BYTES);

        expect(originalBuffer.detached).toBe(true);
        expect(stale.length).toBe(0); // the old view is now zero-length/detached

        writeRamp(memory.buffer, 128, 4, 42);
        const rebuilt = view.get(memory.buffer, 128, 4);

        // A distinct, live view over the new buffer with correct reads — not the
        // detached one, and not garbage. (Object.is avoids Vitest enumerating the
        // detached `stale` array for a diff, which would itself throw.)
        expect(Object.is(rebuilt, stale)).toBe(false);
        expect(rebuilt.length).toBe(4);
        expect(rebuilt.buffer).toBe(memory.buffer);
        expect(Array.from(rebuilt)).toEqual([42, 43, 44, 45]);
    });

    it('keeps reusing the new view after growth once the buffer is stable again', () => {
        const memory = makeMemory();
        const view = new WasmView();

        view.get(memory.buffer, 0, 4);
        memory.buffer = (memory.buffer as ArrayBuffer).transfer(HEAP_BYTES);

        const afterGrowth = view.get(memory.buffer, 0, 4);
        const reused = view.get(memory.buffer, 0, 4);

        expect(reused).toBe(afterGrowth);
    });
});
