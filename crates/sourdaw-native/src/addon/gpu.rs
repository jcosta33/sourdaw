//! The addon export for the GPU memory budget.
//!
//! A free function rather than a `SourdawNative` method: the figure is a property of the machine,
//! needs no singleton, and is asked for only by the main process, so it is not a renderer command and
//! stays out of the exposed/denied command partition.

use napi_derive::napi;

use crate::commands::gpu_memory::gpu_memory_budget_bytes;

/// The largest byte count a JS number holds exactly.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

/// The GPU memory budget in bytes, or null when this machine does not report one.
#[napi]
pub fn gpu_memory_budget() -> Option<i64> {
    gpu_memory_budget_bytes()
        .filter(|bytes| *bytes <= MAX_SAFE_INTEGER)
        .and_then(|bytes| i64::try_from(bytes).ok())
}
