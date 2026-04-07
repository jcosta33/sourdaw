/// Wait-free disk streaming (DFD) architecture.
///
/// Three-component design:
///   - Preload: RAM-cached attack (~12KB per sample) for instant playback start
///   - Ring buffer: per-voice circular buffers (64KB) filled by I/O thread
///   - I/O thread: priority-queued background reader, fills most-starved voices first
///
/// In WASM mode, samples are fully in memory and streaming is bypassed.

pub mod io_thread;
pub mod preload;
pub mod ring_buffer;
