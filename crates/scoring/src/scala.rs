/// Scala .scl and AnaMark .tun file format parsers.
///
/// Scala: comments (!), description, note count N, then N pitch values
/// as either cents (408.0) or ratios (5/4).
///
/// AnaMark: [Scale Begin] / [Scale End] sections with per-note cent values.

/// A parsed Scala scale.
pub struct ScalaScale {
    pub description: [u8; 64],
    pub note_count: usize,
    /// Cents values for each scale degree (up to 128 notes).
    pub cents: [f32; 128],
}

impl ScalaScale {
    pub fn new() -> Self {
        Self {
            description: [0; 64],
            note_count: 0,
            cents: [0.0; 128],
        }
    }

    /// Parse a Scala .scl file from text content.
    pub fn parse_scl(text: &str) -> Option<Self> {
        let mut scale = Self::new();
        let mut lines = text.lines()
            .filter(|l| !l.starts_with('!') && !l.trim().is_empty());

        // First non-comment line = description
        if let Some(desc) = lines.next() {
            let bytes = desc.as_bytes();
            let len = bytes.len().min(64);
            scale.description[..len].copy_from_slice(&bytes[..len]);
        }

        // Second line = note count
        let count_str = lines.next()?;
        let count: usize = count_str.trim().parse().ok()?;
        scale.note_count = count.min(128);

        // Remaining lines = pitch values (cents or ratios)
        for i in 0..scale.note_count {
            if let Some(line) = lines.next() {
                let trimmed = line.trim();
                if trimmed.contains('/') {
                    // Ratio format: p/q → cents = 1200 * log2(p/q)
                    let parts: Vec<&str> = trimmed.split('/').collect();
                    if parts.len() == 2 {
                        let p: f64 = parts[0].trim().parse().unwrap_or(1.0);
                        let q: f64 = parts[1].trim().parse().unwrap_or(1.0);
                        if q > 0.0 {
                            scale.cents[i] = (1200.0 * (p / q).log2()) as f32;
                        }
                    }
                } else if trimmed.contains('.') {
                    // Cents format
                    scale.cents[i] = trimmed.parse().unwrap_or(0.0);
                } else {
                    // Integer — could be cents or ratio numerator
                    let val: f64 = trimmed.parse().unwrap_or(0.0);
                    if val > 100.0 {
                        // Likely cents
                        scale.cents[i] = val as f32;
                    } else {
                        // Likely a ratio with implicit /1
                        scale.cents[i] = (1200.0 * val.log2()) as f32;
                    }
                }
            }
        }

        Some(scale)
    }

    /// Convert the scale to per-pitch-class cent offsets relative to 12-TET.
    /// Returns [12] offsets for C through B.
    pub fn to_12tet_offsets(&self) -> [f32; 12] {
        let mut offsets = [0.0_f32; 12];
        if self.note_count == 0 {
            return offsets;
        }

        // Map scale degrees to the nearest 12-TET pitch class
        for i in 0..self.note_count.min(12) {
            let tet_cents = (i as f32 + 1.0) * 100.0; // 12-TET: 100, 200, 300...
            let scale_cents = self.cents[i];
            offsets[(i + 1) % 12] = scale_cents - tet_cents;
        }

        offsets
    }
}

/// A parsed AnaMark .tun tuning.
pub struct AnaMarkTuning {
    pub base_freq: f32, // default: A=440 at note 69
    pub cents: [f32; 128], // per-note cent values relative to base
}

impl AnaMarkTuning {
    pub fn new() -> Self {
        // Default: 12-TET at A=440
        let mut cents = [0.0_f32; 128];
        for i in 0..128 {
            cents[i] = (i as f32 - 69.0) * 100.0;
        }
        Self { base_freq: 440.0, cents }
    }

    /// Parse an AnaMark .tun file from text.
    pub fn parse_tun(text: &str) -> Option<Self> {
        let mut tuning = Self::new();
        let mut in_scale = false;

        for line in text.lines() {
            let trimmed = line.trim();

            if trimmed == "[Scale Begin]" {
                in_scale = true;
                continue;
            }
            if trimmed == "[Scale End]" {
                in_scale = false;
                continue;
            }

            if trimmed.starts_with("BaseFreq") {
                if let Some(val_str) = trimmed.split('=').nth(1) {
                    tuning.base_freq = val_str.trim().parse().unwrap_or(440.0);
                }
                continue;
            }

            if in_scale {
                // Format: note_number = cents_value
                let parts: Vec<&str> = trimmed.split('=').collect();
                if parts.len() == 2 {
                    if let (Ok(note), Ok(cents)) = (
                        parts[0].trim().parse::<usize>(),
                        parts[1].trim().parse::<f32>(),
                    ) {
                        if note < 128 {
                            tuning.cents[note] = cents;
                        }
                    }
                }
            }
        }

        Some(tuning)
    }

    /// Convert to per-pitch-class offsets (0=C ... 11=B) relative to 12-TET.
    pub fn to_12tet_offsets(&self) -> [f32; 12] {
        let mut offsets = [0.0_f32; 12];
        // Use notes around middle octave (60-71 = C4-B4)
        for i in 0..12 {
            let note = 60 + i;
            let tet_cents = (note as f32 - 69.0) * 100.0;
            offsets[i] = self.cents[note] - tet_cents;
        }
        offsets
    }
}
