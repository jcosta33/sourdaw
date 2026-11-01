/**
 * RT-safe cache of a single WASM linear-memory view for AudioWorklet processors.
 *
 * A `new Float32Array(memory.buffer, ptr, length)` is a heap allocation even
 * though it copies no bytes, so building one per render quantum feeds the GC —
 * "a silent killer in the high-priority world of real-time audio" (Bencina,
 * *Real-time audio programming 101*). At 128-sample quanta each active device
 * would otherwise mint 2–6 of these ~344×/s, so the render thread must reuse a
 * pre-built view whenever the backing buffer, pointer, and length are unchanged.
 *
 * A `WasmView` holds one such view and rebuilds it only when it must:
 *  - first block (no view yet),
 *  - the WASM instance hands back a different pointer, or the block size changes,
 *  - a WASM `memory.grow()` detaches the old `ArrayBuffer` and installs a new one.
 *
 * Growth is the correctness precondition (audit RT-7): Rust-side allocations grow
 * the linear memory, which *detaches* the previous buffer, leaving any cached
 * view zero-length. The wasm-bindgen glue guards its own caches the same way
 * (rebuild when `byteLength === 0`); here the caller reads `memory.buffer` fresh
 * each quantum and passes it in, so a grow shows up as a new buffer *identity*
 * and forces exactly one rebuild — the view is never handed back over a detached
 * buffer.
 *
 * `get` takes positional arguments deliberately: an options-object parameter
 * would allocate one object per call and defeat the entire purpose. In steady
 * state `get` performs only primitive comparisons and returns the cached view
 * with zero allocation.
 */
export class WasmView {
    private _view: Float32Array | null = null;
    private _buffer: ArrayBufferLike | null = null;
    private _ptr = -1;
    private _length = -1;

    /**
     * Return a `Float32Array` mapped over `[ptr, ptr + length)` of `buffer`,
     * reusing the cached instance when `buffer`, `ptr`, and `length` all match
     * the previous call. `buffer` must be read fresh from `memory.buffer` each
     * quantum so a `memory.grow()` is observed as a buffer-identity change.
     */
    get(buffer: ArrayBufferLike, ptr: number, length: number): Float32Array {
        const cached = this._view;
        if (cached !== null && buffer === this._buffer && ptr === this._ptr && length === this._length) {
            return cached;
        }
        const view = new Float32Array(buffer, ptr, length);
        this._view = view;
        this._buffer = buffer;
        this._ptr = ptr;
        this._length = length;
        return view;
    }
}
