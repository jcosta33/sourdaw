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
 * Chunks the loader leaves unacknowledged at once across ALL concurrent Levain
 * loads, not per load: every Levain processor of one `AudioContext` shares one
 * worklet render thread, and devices load in parallel. The loader keeps one
 * budget per main-thread realm (it cannot derive a context from the port it is
 * given), so the one live context is bounded exactly and an offline render's
 * loads share it conservatively. The worklet answers each
 * written chunk with `sampleChunkWritten`, and the loader posts the next one
 * only while fewer than this many are outstanding, so the worklet's queue
 * holds at most this many chunks and it cannot drain a long run of them between
 * two render quanta. This bounds queued upload work; its render-thread timing
 * still depends on the host and must be verified in the browser.
 */
export const LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT = 4;
