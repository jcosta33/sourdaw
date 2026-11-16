//! The GPU memory budget: how many bytes of model weights this machine's GPU can hold.
//!
//! The local model picker gates on it, because system RAM is the wrong figure. A discrete GPU holds
//! far less than the RAM beside it, and Metal caps a process's working set below unified memory, so
//! a model that clears the RAM can still be refused by the GPU after its download.
//!
//! The figure is read where the OS publishes one and is `None` everywhere else, so a caller never
//! mistakes a guess for a measurement:
//!
//! - macOS: the default Metal device's `recommendedMaxWorkingSetSize`.
//! - Windows: the largest `DedicatedVideoMemory` among hardware adapters that are not
//!   unified-memory. An integrated adapter shares system RAM and reports a dedicated figure that
//!   says nothing about what it can hold, so it contributes nothing, as does an adapter whose
//!   architecture cannot be read.
//! - Linux and every other target: unknown.

/// One GPU adapter as the selection rule sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GpuAdapter {
    /// Memory private to the adapter, in bytes.
    pub dedicated_video_memory_bytes: u64,
    /// The adapter shares system memory, or its architecture could not be read.
    pub unified_memory: bool,
    /// A software rasterizer, not a GPU.
    pub software: bool,
}

/// The budget the adapters give: the largest dedicated memory among the hardware, discrete ones.
/// `None` when none of them has any.
pub fn select_discrete_budget(adapters: &[GpuAdapter]) -> Option<u64> {
    adapters
        .iter()
        .filter(|adapter| !adapter.software && !adapter.unified_memory)
        .map(|adapter| adapter.dedicated_video_memory_bytes)
        .filter(|bytes| *bytes > 0)
        .max()
}

/// This machine's GPU memory budget in bytes, or `None` when the OS does not say.
pub fn gpu_memory_budget_bytes() -> Option<u64> {
    platform::read()
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2_metal::{MTLCreateSystemDefaultDevice, MTLDevice};

    pub(super) fn read() -> Option<u64> {
        let device = MTLCreateSystemDefaultDevice()?;
        Some(device.recommendedMaxWorkingSetSize()).filter(|bytes| *bytes > 0)
    }
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::mem::size_of;

    use windows::Win32::Graphics::Direct3D::D3D_FEATURE_LEVEL_11_0;
    use windows::Win32::Graphics::Direct3D12::{
        D3D12CreateDevice, ID3D12Device, D3D12_FEATURE_ARCHITECTURE,
        D3D12_FEATURE_DATA_ARCHITECTURE,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIAdapter1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };

    use super::{select_discrete_budget, GpuAdapter};

    pub(super) fn read() -> Option<u64> {
        // SAFETY: a factory is created with no preconditions, and every adapter it lends is a live COM
        // object owned by the `windows` wrapper for the length of its use here.
        let factory: IDXGIFactory1 = unsafe { CreateDXGIFactory1() }.ok()?;
        let mut adapters = Vec::new();
        let mut index = 0;
        while let Ok(adapter) = unsafe { factory.EnumAdapters1(index) } {
            index += 1;
            let Ok(description) = (unsafe { adapter.GetDesc1() }) else {
                continue;
            };
            adapters.push(GpuAdapter {
                dedicated_video_memory_bytes: description.DedicatedVideoMemory as u64,
                unified_memory: is_unified_or_unknown(&adapter),
                software: description.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0,
            });
        }
        select_discrete_budget(&adapters)
    }

    /// True when the adapter shares system memory, and also when Direct3D 12 cannot say: an adapter
    /// whose architecture is unknown must not lend its dedicated figure to the budget.
    fn is_unified_or_unknown(adapter: &IDXGIAdapter1) -> bool {
        let mut device: Option<ID3D12Device> = None;
        // SAFETY: `device` is a valid out slot for the created device, and `adapter` is a live adapter.
        if unsafe { D3D12CreateDevice(adapter, D3D_FEATURE_LEVEL_11_0, &mut device) }.is_err() {
            return true;
        }
        let Some(device) = device else {
            return true;
        };
        let mut architecture = D3D12_FEATURE_DATA_ARCHITECTURE {
            NodeIndex: 0,
            ..Default::default()
        };
        // SAFETY: the pointer addresses `architecture`, and the size passed is exactly its size.
        let read = unsafe {
            device.CheckFeatureSupport(
                D3D12_FEATURE_ARCHITECTURE,
                (&mut architecture as *mut D3D12_FEATURE_DATA_ARCHITECTURE).cast::<c_void>(),
                size_of::<D3D12_FEATURE_DATA_ARCHITECTURE>() as u32,
            )
        };
        read.is_err() || architecture.UMA.as_bool()
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
mod platform {
    pub(super) fn read() -> Option<u64> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GB: u64 = 1_000_000_000;

    fn adapter(dedicated_gb: u64, unified_memory: bool, software: bool) -> GpuAdapter {
        GpuAdapter {
            dedicated_video_memory_bytes: dedicated_gb * GB,
            unified_memory,
            software,
        }
    }

    #[test]
    fn gpu_budget_is_the_largest_discrete_adapter() {
        let adapters = [
            adapter(8, false, false),
            adapter(24, false, false),
            adapter(12, false, false),
        ];

        assert_eq!(select_discrete_budget(&adapters), Some(24 * GB));
    }

    #[test]
    fn gpu_budget_ignores_unified_memory_adapters() {
        let adapters = [adapter(48, true, false), adapter(8, false, false)];

        assert_eq!(select_discrete_budget(&adapters), Some(8 * GB));
        assert_eq!(select_discrete_budget(&[adapter(48, true, false)]), None);
    }

    #[test]
    fn gpu_budget_ignores_software_adapters() {
        let adapters = [adapter(64, false, true), adapter(6, false, false)];

        assert_eq!(select_discrete_budget(&adapters), Some(6 * GB));
        assert_eq!(select_discrete_budget(&[adapter(64, false, true)]), None);
    }

    #[test]
    fn gpu_budget_is_unknown_without_adapters() {
        assert_eq!(select_discrete_budget(&[]), None);
    }

    #[test]
    fn gpu_budget_is_unknown_when_no_discrete_adapter_has_memory() {
        assert_eq!(select_discrete_budget(&[adapter(0, false, false)]), None);
    }
}
