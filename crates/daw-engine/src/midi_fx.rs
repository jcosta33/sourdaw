use crate::plugin_slot::{MidiNoteEvent, TransportState};

pub trait MidiFx: Send {
    /// Process MIDI events. This can add, remove, or modify events.
    /// Returns the modified list of MIDI events to be passed to the next stage.
    fn process_midi(
        &mut self,
        events: &mut Vec<MidiNoteEvent>,
        transport: &TransportState,
        sample_rate: f32,
        num_samples: usize,
    );

    /// Set a parameter by name and value.
    fn set_param(&mut self, name: &str, value: f32);

    /// Reset internal state (e.g. arpeggiator step counter).
    fn reset(&mut self);
}

pub struct VelocityScaler {
    pub min: u8,
    pub max: u8,
    pub scale: f32,
    pub offset: i16,
}

impl Default for VelocityScaler {
    fn default() -> Self {
        Self {
            min: 0,
            max: 127,
            scale: 1.0,
            offset: 0,
        }
    }
}

impl MidiFx for VelocityScaler {
    fn process_midi(
        &mut self,
        events: &mut Vec<MidiNoteEvent>,
        _transport: &TransportState,
        _sample_rate: f32,
        _num_samples: usize,
    ) {
        for event in events.iter_mut() {
            if event.is_note_on {
                let mut vel = (event.velocity as f32 * self.scale) as i16 + self.offset;
                vel = vel.clamp(self.min as i16, self.max as i16);
                event.velocity = vel as u8;
            }
        }
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "min" => self.min = value.clamp(0.0, 127.0) as u8,
            "max" => self.max = value.clamp(0.0, 127.0) as u8,
            "scale" => self.scale = value,
            "offset" => self.offset = value as i16,
            _ => {}
        }
    }

    fn reset(&mut self) {}
}

pub enum ArpMode {
    Up,
    Down,
    UpDown,
    Random,
}

pub struct Arpeggiator {
    pub mode: ArpMode,
    pub rate_beats: f64,
    pub octave_range: u8,
    active_notes: Vec<u8>,
    current_step: usize,
    last_beat_step: f64,
    step_trigger_count: u64,
}

impl Default for Arpeggiator {
    fn default() -> Self {
        Self {
            mode: ArpMode::Up,
            rate_beats: 0.25, // 1/16th note
            octave_range: 1,
            active_notes: Vec::with_capacity(16),
            current_step: 0,
            last_beat_step: -1.0,
            step_trigger_count: 0,
        }
    }
}

impl MidiFx for Arpeggiator {
    fn process_midi(
        &mut self,
        events: &mut Vec<MidiNoteEvent>,
        transport: &TransportState,
        _sample_rate: f32,
        _num_samples: usize,
    ) {
        let mut new_notes = Vec::new();

        // 1. Maintain active note list from incoming events
        for event in events.iter() {
            if event.is_note_on {
                if !self.active_notes.contains(&event.note) {
                    self.active_notes.push(event.note);
                    self.active_notes.sort_unstable();
                }
            } else {
                self.active_notes.retain(|&n| n != event.note);
            }
        }

        // Clear input events to suppress them from the instrument,
        // we'll replace them with our own arpeggiated events.
        events.clear();

        if self.active_notes.is_empty() {
            self.reset();
            return;
        }

        // 2. Determine if it's time for a new step
        let beat = transport.song_pos_beats;
        let step_count_exact = beat / self.rate_beats;
        let step_beat = step_count_exact.floor();
        
        if step_beat > self.last_beat_step {
            self.last_beat_step = step_beat;
            self.step_trigger_count += 1;

            // 3. Select next note based on mode
            if !self.active_notes.is_empty() {
                match self.mode {
                    ArpMode::Up => {
                        self.current_step = (self.current_step + 1) % self.active_notes.len();
                    }
                    ArpMode::Down => {
                        if self.current_step == 0 {
                            self.current_step = self.active_notes.len() - 1;
                        } else {
                            self.current_step -= 1;
                        }
                    }
                    ArpMode::UpDown => {
                        let n = self.active_notes.len();
                        if n > 1 {
                            let total_steps = n * 2 - 2;
                            let i = (self.step_trigger_count as usize) % total_steps;
                            if i < n {
                                self.current_step = i;
                            } else {
                                self.current_step = total_steps - i;
                            }
                        } else {
                            self.current_step = 0;
                        }
                    }
                    ArpMode::Random => {
                        self.current_step = (self.step_trigger_count as usize * 17) % self.active_notes.len();
                    }
                }

                // 4. Emit the note
                let note = self.active_notes[self.current_step];
                new_notes.push(MidiNoteEvent {
                    note,
                    velocity: 100, // Default for now
                    channel: 0,
                    is_note_on: true,
                    probability: 1.0,
                });
            }
        }

        *events = new_notes;
    }

    fn set_param(&mut self, name: &str, value: f32) {
        match name {
            "rate" => self.rate_beats = value as f64,
            "mode" => {
                self.mode = match value as i32 {
                    0 => ArpMode::Up,
                    1 => ArpMode::Down,
                    2 => ArpMode::UpDown,
                    _ => ArpMode::Random,
                };
            }
            "octaves" => self.octave_range = value as u8,
            _ => {}
        }
    }

    fn reset(&mut self) {
        self.current_step = 0;
        self.last_beat_step = -1.0;
        self.step_trigger_count = 0;
    }
}

pub struct ProbabilityEvaluator {
    seed: u64,
}

impl Default for ProbabilityEvaluator {
    fn default() -> Self {
        Self { seed: 12345 }
    }
}

impl MidiFx for ProbabilityEvaluator {
    fn process_midi(
        &mut self,
        events: &mut Vec<MidiNoteEvent>,
        _transport: &TransportState,
        _sample_rate: f32,
        _num_samples: usize,
    ) {
        // Simple linear congruential generator for deterministic probability
        let mut seed = self.seed;
        events.retain_mut(|event| {
            if event.probability >= 1.0 { return true; }
            if event.probability <= 0.0 { return false; }

            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            let roll = (seed >> 32) as f32 / 4294967296.0;
            roll <= event.probability
        });
        self.seed = seed;
    }

    fn set_param(&mut self, name: &str, value: f32) {
        if name == "seed" {
            self.seed = value as u64;
        }
    }

    fn reset(&mut self) {}
}
