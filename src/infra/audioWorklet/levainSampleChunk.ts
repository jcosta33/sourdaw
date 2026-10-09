/**
 * Floats one Levain `sampleChunk` message carries at most (64 KiB of PCM).
 *
 * The loader slices a decoded sample into chunks of this size so that no
 * worklet message copies more than this into the engine on the render thread.
 * The engine enforces the same ceiling (`LEVAIN_SAMPLE_CHUNK_FLOATS` in
 * `crates/daw-dsp/src/levain/mod.rs`): its write window never offers more and
 * it refuses a larger count, so a chunk above this is rejected, not trusted.
 * A spec (`AudioEngine/services/__tests__/levainProcessorSampleUpload.spec.ts`)
 * pins this equal to the shipped engine's window.
 */
export const LEVAIN_SAMPLE_CHUNK_FLOATS = 16_384;

/**
 * Chunks the loader leaves unacknowledged at once. The worklet answers each
 * written chunk with `sampleChunkWritten`, and the loader posts the next one
 * only while fewer than this many are outstanding, so the worklet's queue
 * holds at most this many chunks and it cannot drain a long run of them between
 * two render quanta. A chunk's handler costs up to about a third of a
 * millisecond (measured on the shipped wasm), so four queued chunks keep the
 * most one gap can hold near 1.2 ms, under half of a 2.67 ms quantum. The load
 * is bound by the acknowledgement's round trip, not by the copy: with a 1 ms
 * hop each way a violin-sized bank took 2.7 s with two in flight and 1.4 s
 * with four (Node, shipped wasm), so four halves the wait for the same
 * per-gap bound.
 */
export const LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT = 4;
