/// Bridge: implements daw_engine::NativePlugin for ClapWrapper.
///
/// This allows ClapWrapper instances to be sent to the native audio thread
/// and processed inline by the scheduler — no IPC in the audio path.

use daw_engine::plugin_slot::NativePlugin;
use crate::host::clap_wrapper::ClapWrapper;

/// Newtype wrapper that implements NativePlugin for ClapWrapper.
/// ClapWrapper already implements Send + Sync.
pub struct ClapPluginSlot {
    pub wrapper: ClapWrapper,
}

impl NativePlugin for ClapPluginSlot {
    fn process_audio(&mut self, left: &mut [f32], right: &mut [f32], num_samples: usize) {
        // Build input slices (ClapWrapper::process expects &[&[f32]] for inputs)
        let inputs: [&[f32]; 2] = [&left[..num_samples], &right[..num_samples]];

        // Build output slices
        let mut out_l = vec![0.0f32; num_samples];
        let mut out_r = vec![0.0f32; num_samples];
        {
            let mut outputs: [&mut [f32]; 2] = [&mut out_l, &mut out_r];
            self.wrapper.process(&inputs, &mut outputs, num_samples);
        }

        // Copy processed output back to the in-place buffers
        left[..num_samples].copy_from_slice(&out_l);
        right[..num_samples].copy_from_slice(&out_r);
    }

    fn set_param(&mut self, param_id: u32, value: f64) {
        self.wrapper.set_parameter(param_id, value);
    }

    fn name(&self) -> &str {
        self.wrapper.get_name()
    }
}
