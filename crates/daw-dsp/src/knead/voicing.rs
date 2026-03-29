//! Voiced/Unvoiced gating logic

pub struct VoicingConfig {
    pub min_voiced_confidence: f32, // Based on array threshold/periodicity
    pub energy_threshold: f32, // Silence cutoff
}

impl Default for VoicingConfig {
    fn default() -> Self {
        Self {
            min_voiced_confidence: 0.7, // 0..1 range
            energy_threshold: -60.0, // dB
        }
    }
}

pub fn is_voiced(buffer: &[f32], periodicity: f32, cfg: &VoicingConfig) -> bool {
    let mut energy = 0.0;
    for &sample in buffer {
        energy += sample * sample;
    }
    
    // Convert energy over frame to approx dB
    let rms = (energy / buffer.len() as f32).sqrt().max(1e-9);
    let db = 20.0 * rms.log10();

    if db < cfg.energy_threshold {
        return false;
    }

    periodicity > cfg.min_voiced_confidence
}
