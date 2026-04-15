/// Unified Crumbs Suite — core engine module.
///
/// Provides a four-mode crumbs (Quick, Drum, Slice, Warp) with:
///   - Lock-free voice allocation (128 voices, AtomicU64 bitfield)
///   - 6-state AHDSR envelope with configurable curve shape
///   - Cubic Hermite interpolation playback
///   - Cytomic TPT SVF filter with simultaneous multi-output
///   - One-pole parameter smoothing with denormal prevention
///   - In-memory sample pool
///   - Command-queue driven engine with atomic metering
pub mod allocator;
pub mod analysis;
pub mod engine;
pub mod envelope;
pub mod filter;
pub mod modes;
pub mod sample;
pub mod smooth;
pub mod streaming;
pub mod types;
pub mod voice;
pub mod warp;
