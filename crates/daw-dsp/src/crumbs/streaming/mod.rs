/// Disk-streaming (DFD) bookkeeping for the integration layer.
///
/// Three components, none of which own a thread or perform I/O:
///   - Preload: RAM-cached attack (~12KB per sample) for instant playback start
///   - Ring buffer: a per-voice circular buffer (64KB) over plain `&mut self`
///   - Scheduler: priority ordering of read requests, most-starved voice first
///
/// Everything here is single-threaded and synchronous. The types are driven by
/// whichever thread the integration layer (daw-engine / src-tauri) calls them
/// from; it owns the reader thread, the file handles, and any cross-thread
/// handoff. Nothing in this crate is wait-free or lock-free by construction —
/// there is not an atomic in the module — so a caller that wants an audio
/// thread reading while another thread writes has to supply that channel
/// itself. Sharing one `VoiceStreamBuffer` across two threads is unsound, not
/// merely unsupported.
///
/// In WASM mode, samples are fully in memory and streaming is bypassed.
pub mod io_thread;
pub mod preload;
pub mod ring_buffer;
