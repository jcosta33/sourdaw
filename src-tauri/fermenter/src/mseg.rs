//! Multi-Segment Envelope Generator (MSEG).
//! 8 breakpoints with configurable level, time, and curve per segment.
//! Can loop a range of segments for sustained patterns.

pub const MSEG_SEGMENTS: usize = 8;

#[derive(Clone, Copy)]
pub struct MsegSegment {
    /// Target level at end of segment (0.0-1.0)
    pub level: f32,
    /// Duration of segment in seconds (0.001-10.0)
    pub time: f32,
    /// Curve shape: 0=linear, <0=exponential concave, >0=exponential convex (-4 to +4)
    pub curve: f32,
}

impl Default for MsegSegment {
    fn default() -> Self {
        Self { level: 0.0, time: 0.1, curve: 0.0 }
    }
}

#[derive(Clone)]
pub struct Mseg {
    segments: [MsegSegment; MSEG_SEGMENTS],
    /// Number of active segments (1-8)
    num_segments: usize,
    /// Current segment index
    current_seg: usize,
    /// Progress through current segment (0.0-1.0)
    phase: f32,
    /// Phase increment per sample for current segment
    phase_inc: f32,
    /// Level at start of current segment
    start_level: f32,
    /// Current output level
    level: f32,
    /// Loop start segment (0 = no loop, >0 = loop from this segment)
    loop_start: usize,
    /// Loop end segment
    loop_end: usize,
    /// Whether the MSEG is currently active
    active: bool,
    /// Whether note is held (for sustain/loop behavior)
    gate: bool,
    /// Sustain segment index (envelope holds here until note off, 0=none)
    sustain_seg: usize,
    sample_rate: f32,
}

impl Mseg {
    pub fn new(sample_rate: f32) -> Self {
        // Default: simple attack-sustain-release shape
        let mut segments = [MsegSegment::default(); MSEG_SEGMENTS];
        segments[0] = MsegSegment { level: 1.0, time: 0.01, curve: 0.0 };  // attack
        segments[1] = MsegSegment { level: 0.7, time: 0.2, curve: -1.0 };  // decay
        segments[2] = MsegSegment { level: 0.7, time: 1.0, curve: 0.0 };   // sustain hold
        segments[3] = MsegSegment { level: 0.0, time: 0.3, curve: -2.0 };  // release

        Self {
            segments,
            num_segments: 4,
            current_seg: 0,
            phase: 0.0,
            phase_inc: 0.0,
            start_level: 0.0,
            level: 0.0,
            loop_start: 0,
            loop_end: 0,
            active: false,
            gate: false,
            sustain_seg: 2, // hold at segment 2
            sample_rate,
        }
    }

    pub fn set_segment(&mut self, idx: usize, level: f32, time: f32, curve: f32) {
        if idx < MSEG_SEGMENTS {
            self.segments[idx] = MsegSegment {
                level: level.clamp(0.0, 1.0),
                time: time.clamp(0.001, 10.0),
                curve: curve.clamp(-4.0, 4.0),
            };
        }
    }

    pub fn set_num_segments(&mut self, n: usize) {
        self.num_segments = n.clamp(1, MSEG_SEGMENTS);
    }

    pub fn set_loop(&mut self, start: usize, end: usize) {
        self.loop_start = start;
        self.loop_end = end.min(MSEG_SEGMENTS);
    }

    pub fn set_sustain_seg(&mut self, seg: usize) {
        self.sustain_seg = seg;
    }

    pub fn note_on(&mut self) {
        self.active = true;
        self.gate = true;
        self.current_seg = 0;
        self.phase = 0.0;
        self.start_level = 0.0;
        self.level = 0.0;
        self.update_phase_inc();
    }

    pub fn note_off(&mut self) {
        self.gate = false;
        // If we were sustaining, advance past sustain segment
        if self.sustain_seg > 0 && self.current_seg == self.sustain_seg {
            self.advance_segment();
        }
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    pub fn get_level(&self) -> f32 {
        self.level
    }

    fn update_phase_inc(&mut self) {
        if self.current_seg < self.num_segments {
            let time = self.segments[self.current_seg].time;
            let samples = time * self.sample_rate;
            self.phase_inc = if samples > 0.0 { 1.0 / samples } else { 1.0 };
        }
    }

    fn advance_segment(&mut self) {
        self.start_level = self.level;
        self.current_seg += 1;
        self.phase = 0.0;

        // Handle looping
        if self.loop_end > self.loop_start && self.current_seg >= self.loop_end && self.gate {
            self.current_seg = self.loop_start;
        }

        if self.current_seg >= self.num_segments {
            self.active = false;
            self.level = 0.0;
        } else {
            self.update_phase_inc();
        }
    }

    #[inline]
    pub fn tick(&mut self) -> f32 {
        if !self.active {
            return 0.0;
        }

        // Sustain hold
        if self.sustain_seg > 0 && self.current_seg == self.sustain_seg && self.gate {
            return self.level;
        }

        if self.current_seg >= self.num_segments {
            self.active = false;
            return 0.0;
        }

        let seg = &self.segments[self.current_seg];
        let target = seg.level;
        let curve = seg.curve;

        // Apply curve to phase
        let shaped = if curve.abs() < 0.01 {
            self.phase // linear
        } else if curve > 0.0 {
            self.phase.powf(1.0 + curve) // convex (slow start)
        } else {
            1.0 - (1.0 - self.phase).powf(1.0 - curve) // concave (fast start)
        };

        self.level = self.start_level + (target - self.start_level) * shaped;

        self.phase += self.phase_inc;
        if self.phase >= 1.0 {
            self.level = target;
            self.advance_segment();
        }

        self.level
    }

    pub fn reset(&mut self) {
        self.active = false;
        self.gate = false;
        self.current_seg = 0;
        self.phase = 0.0;
        self.level = 0.0;
    }
}
