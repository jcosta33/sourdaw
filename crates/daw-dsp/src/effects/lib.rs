use wasm_bindgen::prelude::*;

mod eq;
mod compressor;
mod limiter;
mod reverb;
mod delay;
mod gate;
mod gain;
mod proof_chamber;

use eq::ParametricEq;
use compressor::Compressor;
use limiter::BrickwallLimiter;
use reverb::AlgorithmicReverb;
use delay::StereoDelay;
use gate::NoiseGate;
use gain::GainUtility;
use proof_chamber::ProofChamber;

// ---------------------------------------------------------------------------
// Multi-plugin WASM processor
// ---------------------------------------------------------------------------

enum PluginCore {
    Eq(ParametricEq),
    Compressor(Compressor),
    Limiter(BrickwallLimiter),
    Reverb(AlgorithmicReverb),
    Delay(StereoDelay),
    Gate(NoiseGate),
    Gain(GainUtility),
    ProofChamber(ProofChamber),
}

#[wasm_bindgen]
pub struct WasmPluginInstance {
    core: PluginCore,
    bypassed: bool,
    out_left: Vec<f32>,
    out_right: Vec<f32>,
}

#[wasm_bindgen]
impl WasmPluginInstance {
    /// Create a new plugin instance by type name.
    /// Valid types: "eq", "compressor", "limiter", "reverb", "delay", "gate", "gain"
    #[wasm_bindgen(constructor)]
    pub fn new(plugin_type: &str, sample_rate: f32) -> Result<WasmPluginInstance, JsValue> {
        let core = match plugin_type {
            "eq" => PluginCore::Eq(ParametricEq::new(sample_rate)),
            "compressor" => PluginCore::Compressor(Compressor::new(sample_rate)),
            "limiter" => PluginCore::Limiter(BrickwallLimiter::new(sample_rate)),
            "reverb" => PluginCore::Reverb(AlgorithmicReverb::new(sample_rate)),
            "delay" => PluginCore::Delay(StereoDelay::new(sample_rate)),
            "gate" => PluginCore::Gate(NoiseGate::new(sample_rate)),
            "gain" => PluginCore::Gain(GainUtility::new()),
            "proof-chamber" => PluginCore::ProofChamber(ProofChamber::new(sample_rate)),
            _ => return Err(JsValue::from_str(&format!("Unknown plugin type: {plugin_type}"))),
        };

        Ok(WasmPluginInstance {
            core,
            bypassed: false,
            out_left: vec![0.0; 128],
            out_right: vec![0.0; 128],
        })
    }

    /// Set a named parameter on the plugin.
    #[wasm_bindgen]
    pub fn set_param(&mut self, name: &str, value: f32) {
        match &mut self.core {
            PluginCore::Eq(p) => p.set_param(name, value),
            PluginCore::Compressor(p) => p.set_param(name, value),
            PluginCore::Limiter(p) => p.set_param(name, value),
            PluginCore::Reverb(p) => p.set_param(name, value),
            PluginCore::Delay(p) => p.set_param(name, value),
            PluginCore::Gate(p) => p.set_param(name, value),
            PluginCore::Gain(p) => p.set_param(name, value),
            PluginCore::ProofChamber(p) => p.set_param(name, value),
        }
    }

    /// Set bypass state.
    #[wasm_bindgen]
    pub fn set_bypass(&mut self, bypassed: bool) {
        self.bypassed = bypassed;
    }

    /// Process stereo audio. Returns pointer to interleaved [L0..LN, R0..RN] output.
    #[wasm_bindgen]
    pub fn process_stereo(&mut self, left_in: &[f32], right_in: &[f32], frames: usize) -> *const f32 {
        // Ensure output buffers are large enough
        if self.out_left.len() < frames {
            self.out_left.resize(frames, 0.0);
            self.out_right.resize(frames, 0.0);
        }

        if self.bypassed {
            self.out_left[..frames].copy_from_slice(&left_in[..frames]);
            self.out_right[..frames].copy_from_slice(&right_in[..frames]);
        } else {
            // Copy input to output buffers first (plugins process in-place)
            self.out_left[..frames].copy_from_slice(&left_in[..frames]);
            self.out_right[..frames].copy_from_slice(&right_in[..frames]);

            match &mut self.core {
                PluginCore::Eq(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
                PluginCore::Compressor(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
                PluginCore::Limiter(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
                PluginCore::Reverb(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
                PluginCore::Delay(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
                PluginCore::Gate(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
                PluginCore::Gain(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
                PluginCore::ProofChamber(p) => p.process(&mut self.out_left[..frames], &mut self.out_right[..frames]),
            }
        }

        self.out_left.as_ptr()
    }

    /// Get pointer to right channel output (call after process_stereo).
    #[wasm_bindgen]
    pub fn get_right_ptr(&self) -> *const f32 {
        self.out_right.as_ptr()
    }

    /// Get the names of all parameters for this plugin type, as JSON array.
    #[wasm_bindgen]
    pub fn get_param_names(&self) -> String {
        let names: Vec<&str> = match &self.core {
            PluginCore::Eq(p) => p.param_names(),
            PluginCore::Compressor(p) => p.param_names(),
            PluginCore::Limiter(p) => p.param_names(),
            PluginCore::Reverb(p) => p.param_names(),
            PluginCore::Delay(p) => p.param_names(),
            PluginCore::Gate(p) => p.param_names(),
            PluginCore::Gain(p) => p.param_names(),
            PluginCore::ProofChamber(p) => p.param_names(),
        };
        serde_json::to_string(&names).unwrap_or_else(|_| "[]".to_string())
    }
}
