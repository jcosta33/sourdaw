//! The Windows device layer: IAudioClient3 shared low-latency by
//! default, WASAPI Exclusive as an explicit opt-in, no ASIO — ADR 0027.
//!
//! [`policy`] is the pure half — period arithmetic, the format ladder,
//! the HRESULT taxonomy, the exclusive-degrade decision — compiled and
//! tested on every host. [`backend`] is the COM plumbing that carries
//! those decisions to WASAPI and only compiles for Windows.

pub(crate) mod policy;

#[cfg(windows)]
pub(crate) mod backend;
