/// VST3 plugin wrapper — loads .vst3 bundles and extracts metadata.
///
/// Uses libloading to dlopen the VST3 binary and call GetPluginFactory().
/// Full COM initialization (IComponent → IAudioProcessor) is pending —
/// audio processing is passthrough until then.
use crate::params::PluginParameter;
use crate::traits::AudioPlugin;
use libloading::Library;
use std::ffi::{c_void, CStr};
use std::ptr;

type GetPluginFactoryFn = unsafe extern "system" fn() -> *mut c_void;

pub struct Vst3Wrapper {
    _library: Library,
    name: String,
    activated: bool,
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

        // Verify GetPluginFactory exists
        let _factory_fn: libloading::Symbol<GetPluginFactoryFn> = unsafe {
            library
                .get(b"GetPluginFactory\0")
                .map_err(|e| format!("No GetPluginFactory in {}: {}", binary_path, e))?
        };

        let name = std::path::Path::new(bundle_path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "VST3 Plugin".to_string());

        eprintln!("[VST3] Loaded '{}' — COM audio processing pending", name);

        Ok(Self {
            _library: library,
            name,
            activated: false,
        })
    }

    fn resolve_binary_path(bundle_path: &str) -> Result<String, String> {
        let bundle = std::path::Path::new(bundle_path);
        let stem = bundle
            .file_stem()
            .ok_or("Invalid bundle path")?
            .to_string_lossy();

        // macOS: Contents/MacOS/<name>
        #[cfg(target_os = "macos")]
        {
            let binary = bundle.join("Contents").join("MacOS").join(stem.as_ref());
            if binary.exists() {
                return Ok(binary.to_string_lossy().into_owned());
            }
        }

        // Windows: Contents/x86_64-win/<name>.vst3
        #[cfg(target_os = "windows")]
        {
            let binary = bundle
                .join("Contents")
                .join("x86_64-win")
                .join(format!("{}.vst3", stem));
            if binary.exists() {
                return Ok(binary.to_string_lossy().into_owned());
            }
        }

        // Linux: Contents/x86_64-linux/<name>.so
        #[cfg(target_os = "linux")]
        {
            let binary = bundle
                .join("Contents")
                .join("x86_64-linux")
                .join(format!("{}.so", stem));
            if binary.exists() {
                return Ok(binary.to_string_lossy().into_owned());
            }
        }

        Err(format!(
            "Could not find VST3 binary in bundle: {}",
            bundle_path
        ))
    }

    pub fn get_name(&self) -> &str {
        &self.name
    }
}

impl AudioPlugin for Vst3Wrapper {
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
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
