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
    js_exact_byte_count(gpu_memory_budget_bytes())
}

/// A byte count as JS can hold it exactly, or `None` when it would round.
fn js_exact_byte_count(bytes: Option<u64>) -> Option<i64> {
    bytes
        .filter(|bytes| *bytes <= MAX_SAFE_INTEGER)
        .and_then(|bytes| i64::try_from(bytes).ok())
}

#[cfg(test)]
mod tests {
    use super::{js_exact_byte_count, MAX_SAFE_INTEGER};

    #[test]
    fn a_budget_a_js_number_holds_exactly_crosses_unchanged() {
        assert_eq!(js_exact_byte_count(Some(0)), Some(0));
        assert_eq!(
            js_exact_byte_count(Some(8 * 1024 * 1024 * 1024)),
            Some(8 * 1024 * 1024 * 1024)
        );
        assert_eq!(
            js_exact_byte_count(Some(MAX_SAFE_INTEGER)),
            Some((1_i64 << 53) - 1)
        );
    }

    #[test]
    fn a_budget_a_js_number_would_round_is_not_reported() {
        assert_eq!(js_exact_byte_count(Some(MAX_SAFE_INTEGER + 1)), None);
        assert_eq!(js_exact_byte_count(Some(u64::MAX)), None);
    }

    #[test]
    fn an_unreported_budget_stays_unreported() {
        assert_eq!(js_exact_byte_count(None), None);
    }
}
