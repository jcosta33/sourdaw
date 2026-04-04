use crate::params::PluginParameter;
use std::any::Any;

pub trait AudioPlugin: Send + Sync + Any {
    /// Process a block of audio.
    /// `inputs`: slice of channel buffers (e.g., [left_in, right_in])
    /// `outputs`: slice of mutable channel buffers (e.g., [left_out, right_out])
    /// `num_samples`: number of samples per channel to process
    fn process(&mut self, inputs: &[&[f32]], outputs: &mut [&mut [f32]], num_samples: usize);

    /// Set a parameter value (typically 0.0 to 1.0 normalized)
    fn set_parameter(&mut self, param_id: u32, value: f64);

    /// Get all parameters exposed by the plugin
    fn get_parameters(&self) -> Vec<PluginParameter>;

    /// Get the opaque binary state of the plugin
    fn get_state(&self) -> Vec<u8>;

    /// Set the opaque binary state of the plugin
    fn set_state(&mut self, state: &[u8]);

    /// Upcast to Any for downcasting to concrete types.
    fn as_any(&self) -> &dyn Any;

    /// Upcast to Any (mutable) for downcasting to concrete types.
    fn as_any_mut(&mut self) -> &mut dyn Any;
}
