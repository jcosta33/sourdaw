// We stub the VST3 Host wrapper here.
// VST3 relies on deep COM interface querying, specifically:
// - IPluginFactory
// - IComponent (for processing)
// - IEditController (for parameters)
// Full implementation requires significant boilerplate mapping COM `HRESULT`s to standard Rust results.

use crate::commands::plugins::PluginParameter;
use crate::host::traits::AudioPlugin;

pub struct Vst3Wrapper {
    _plugin_id: String,
}

impl Vst3Wrapper {
    pub fn new(plugin_path: &str) -> Result<Self, String> {
        Ok(Self { _plugin_id: plugin_path.to_string() })
    }
}

impl AudioPlugin for Vst3Wrapper {
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize) {
        // Passthrough: copy input to output
        for (ch, out) in outputs.iter_mut().enumerate() {
            if ch < inputs.len() {
                let len = num_samples.min(inputs[ch].len()).min(out.len());
                out[..len].copy_from_slice(&inputs[ch][..len]);
            }
        }
    }

    fn set_parameter(&mut self, _param_id: u32, _value: f64) {
    }

    fn get_parameters(&self) -> Vec<PluginParameter> {
        vec![]
    }

    fn get_state(&self) -> Vec<u8> {
        vec![]
    }

    fn set_state(&mut self, _state: &[u8]) {
    }
}
