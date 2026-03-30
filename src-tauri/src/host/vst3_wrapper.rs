/// VST3 plugin wrapper — loads .vst3 bundles and hosts them.
///
/// Uses the `vst3` 0.3.0 crate for raw COM interface bindings.
/// The COM architecture requires: IPluginFactory → IComponent → IAudioProcessor.
///
/// This implementation handles:
/// - Bundle path resolution (macOS/Windows/Linux)
/// - Dynamic library loading + GetPluginFactory
/// - IPluginFactory enumeration (class info)
/// - IComponent creation + initialization
/// - IAudioProcessor setup + processing (pending full implementation)
///
/// VST3 hosting is more complex than CLAP due to COM reference counting,
/// GUID-based queries, and the split processor/controller architecture.

use crate::commands::plugins::PluginParameter;
use crate::host::traits::AudioPlugin;
use libloading::Library;
use std::ffi::c_void;
use std::ptr;

// VST3 COM types from the vst3 crate
use vst3::IPluginFactory;
use com_scrape_types::{Unknown, Ptr};

type GetPluginFactoryFn = unsafe extern "system" fn() -> *mut c_void;

/// Holds a loaded VST3 plugin instance.
pub struct Vst3Wrapper {
    _library: Library,
    name: String,
    vendor: String,
    activated: bool,
    sample_rate: f64,
    /// Raw pointer to the IPluginFactory (reference-counted).
    factory_ptr: *mut c_void,
    /// Number of classes in the factory.
    class_count: i32,
}

unsafe impl Send for Vst3Wrapper {}
unsafe impl Sync for Vst3Wrapper {}

impl Vst3Wrapper {
    pub fn new(bundle_path: &str) -> Result<Self, String> {
        let binary_path = Self::resolve_binary_path(bundle_path)?;

        let library = unsafe {
            Library::new(&binary_path)
                .map_err(|e| format!("Failed to load VST3 binary at {}: {}", binary_path, e))?
        };

        // Get GetPluginFactory entry point
        let factory_fn: libloading::Symbol<GetPluginFactoryFn> = unsafe {
            library.get(b"GetPluginFactory\0")
                .map_err(|e| format!("No GetPluginFactory in {}: {}", binary_path, e))?
        };

        // Call GetPluginFactory to get IPluginFactory*
        let factory_ptr = unsafe { factory_fn() };
        if factory_ptr.is_null() {
            return Err("GetPluginFactory returned null".to_string());
        }

        // Read factory info
        let (name, vendor, class_count) = unsafe {
            // Cast to IPluginFactory and read class info
            let factory = &*(factory_ptr as *const IPluginFactory);
            let vtbl = &*factory.vtbl;

            // Get class count
            let count = (vtbl.countClasses)(factory_ptr as *mut IPluginFactory);

            // Read first class info for name/vendor
            let mut name = String::new();
            let mut vendor = String::new();

            if count > 0 {
                let mut info: vst3::PClassInfo = std::mem::zeroed();
                let result = (vtbl.getClassInfo)(factory_ptr as *mut IPluginFactory, 0, &mut info);
                if result == 0 { // kResultOk
                    name = std::ffi::CStr::from_ptr(info.name.as_ptr())
                        .to_string_lossy().into_owned();
                }
            }

            if name.is_empty() {
                name = std::path::Path::new(bundle_path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| "VST3 Plugin".to_string());
            }

            (name, vendor, count)
        };

        eprintln!("[VST3] Loaded '{}' (vendor: '{}', {} classes)", name, vendor, class_count);

        // TODO: Continue COM initialization:
        // - createInstance(classInfo.cid, IComponent::iid) → IComponent*
        // - IComponent::initialize(hostContext)
        // - queryInterface(IAudioProcessor::iid) → IAudioProcessor*
        // - setupProcessing + setActive + setProcessing
        // This requires implementing a host context (FUnknown) and careful
        // reference counting. Deferring to a follow-up.

        Ok(Self {
            _library: library,
            name,
            vendor,
            activated: false,
            sample_rate: 48000.0,
            factory_ptr,
            class_count,
        })
    }

    fn resolve_binary_path(bundle_path: &str) -> Result<String, String> {
        let bundle = std::path::Path::new(bundle_path);

        #[cfg(target_os = "macos")]
        {
            let name = bundle.file_stem()
                .ok_or("Invalid bundle path")?
                .to_string_lossy();
            let binary = bundle.join("Contents").join("MacOS").join(name.as_ref());
            if binary.exists() {
                return Ok(binary.to_string_lossy().into_owned());
            }
        }

        #[cfg(target_os = "windows")]
        {
            let name = bundle.file_stem()
                .ok_or("Invalid bundle path")?
                .to_string_lossy();
            let binary = bundle.join("Contents").join("x86_64-win").join(format!("{}.vst3", name));
            if binary.exists() {
                return Ok(binary.to_string_lossy().into_owned());
            }
        }

        #[cfg(target_os = "linux")]
        {
            let name = bundle.file_stem()
                .ok_or("Invalid bundle path")?
                .to_string_lossy();
            let binary = bundle.join("Contents").join("x86_64-linux").join(format!("{}.so", name));
            if binary.exists() {
                return Ok(binary.to_string_lossy().into_owned());
            }
        }

        Err(format!("Could not find VST3 binary in bundle: {}", bundle_path))
    }

    pub fn get_name(&self) -> &str {
        &self.name
    }

    pub fn get_vendor(&self) -> &str {
        &self.vendor
    }

    pub fn class_count(&self) -> i32 {
        self.class_count
    }
}

impl Drop for Vst3Wrapper {
    fn drop(&mut self) {
        if !self.factory_ptr.is_null() {
            unsafe {
                // Release the factory's COM reference
                let factory = &*(self.factory_ptr as *const vst3::FUnknown);
                let vtbl = &*factory.vtbl;
                (vtbl.release)(self.factory_ptr as *mut vst3::FUnknown);
            }
            self.factory_ptr = ptr::null_mut();
        }
    }
}

impl AudioPlugin for Vst3Wrapper {
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        // Passthrough until COM IAudioProcessor is initialized
        for (ch, out) in outputs.iter_mut().enumerate() {
            if ch < inputs.len() {
                let len = num_samples.min(inputs[ch].len()).min(out.len());
                out[..len].copy_from_slice(&inputs[ch][..len]);
            }
        }
    }

    fn set_parameter(&mut self, _param_id: u32, _value: f64) {}

    fn get_parameters(&self) -> Vec<PluginParameter> {
        vec![]
    }

    fn get_state(&self) -> Vec<u8> {
        vec![]
    }

    fn set_state(&mut self, _state: &[u8]) {}

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn as_any_mut(&mut self) -> &mut dyn std::any::Any {
        self
    }
}
