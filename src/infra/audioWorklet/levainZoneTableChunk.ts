/**
 * Entries one Levain `zoneTableChunk` message carries at most. A LUT entry
 * travels as two words (offset, count), so a full LUT chunk is 64 KiB.
 *
 * The loader slices a bank's zone tables into chunks of this size so that no
 * worklet message appends more than this to the staged tables on the render
 * thread. The engine enforces the same ceiling
 * (`LEVAIN_ZONE_TABLE_CHUNK_ENTRIES` in `crates/daw-dsp/src/levain/mod.rs`): its
 * write window holds one LUT chunk and it refuses a longer one, so a chunk above
 * this is rejected, not trusted. A spec
 * (`AudioEngine/services/__tests__/levainProcessorZoneTables.spec.ts`) pins this
 * equal to the shipped engine's window. The chunks share the realm-wide
 * `LEVAIN_SAMPLE_CHUNKS_IN_FLIGHT` budget with the sample chunks: both land on
 * the same render thread.
 */
export const LEVAIN_ZONE_TABLE_CHUNK_ENTRIES = 8_192;
