//! FM/Phase Modulation synthesis engine.
//! 4 operators with arbitrary routing matrix and per-operator envelopes.

use core::f32::consts::TAU;

/// Single FM operator: sine oscillator with phase modulation input.
#[derive(Clone)]
pub struct FmOperator {
    phase: f32,
    prev_output: f32,  // for feedback
    pub ratio: f32,         // frequency ratio to carrier
    pub level: f32,         // output level 0-1
    pub feedback: f32,      // self-feedback amount 0-1
}

impl FmOperator {
    pub fn new() -> Self {
        Self { phase: 0.0, prev_output: 0.0, ratio: 1.0, level: 1.0, feedback: 0.0 }
    }

    pub fn reset(&mut self) {
        self.phase = 0.0;
        self.prev_output = 0.0;
    }

    #[inline]
    pub fn tick(&mut self, base_freq: f32, sample_rate: f32, mod_input: f32) -> f32 {
        let freq = base_freq * self.ratio;
        let fb = self.prev_output * self.feedback;
        let output = (self.phase * TAU + mod_input + fb).sin() * self.level;
        self.phase += freq / sample_rate;
        if self.phase >= 1.0 { self.phase -= 1.0; }
        self.prev_output = output;
        output
    }
}

/// 4-operator FM engine with routing matrix.
/// Routing: matrix[i][j] means operator i modulates operator j.
/// Carriers are operators whose output goes to the final mix.
#[derive(Clone)]
pub struct FmEngine {
    pub ops: [FmOperator; 4],
    /// Modulation matrix: amount that op[row] modulates op[col].
    pub matrix: [[f32; 4]; 4],
    /// Which operators are carriers (output to mix). Bitfield.
    pub carriers: u8,
    /// Algorithm preset index
    pub algorithm: u8,
}

impl FmEngine {
    pub fn new() -> Self {
        let mut engine = Self {
            ops: [FmOperator::new(), FmOperator::new(), FmOperator::new(), FmOperator::new()],
            matrix: [[0.0; 4]; 4],
            carriers: 0b0001, // Op 1 is carrier by default
            algorithm: 0,
        };
        engine.set_algorithm(0);
        engine
    }

    pub fn reset(&mut self) {
        for op in &mut self.ops {
            op.reset();
        }
    }

    /// Set one of 8 preset algorithms (simplified from DX7's 32).
    pub fn set_algorithm(&mut self, alg: u8) {
        self.algorithm = alg;
        self.matrix = [[0.0; 4]; 4];
        // Reset feedback on all ops before setting algorithm
        for op in &mut self.ops {
            op.feedback = 0.0;
        }
        match alg {
            0 => {
                // Stack: 4->3->2->1(C)
                self.matrix[3][2] = 1.0;
                self.matrix[2][1] = 1.0;
                self.matrix[1][0] = 1.0;
                self.carriers = 0b0001;
            }
            1 => {
                // Parallel pairs: 2->1(C), 4->3(C)
                self.matrix[1][0] = 1.0;
                self.matrix[3][2] = 1.0;
                self.carriers = 0b0101;
            }
            2 => {
                // Y: 3->1(C), 4->2->1(C)
                self.matrix[2][0] = 1.0;
                self.matrix[3][1] = 1.0;
                self.matrix[1][0] = 1.0;
                self.carriers = 0b0001;
            }
            3 => {
                // All carriers (additive)
                self.carriers = 0b1111;
            }
            4 => {
                // Fork: 4->(2,3), 2->1(C), 3->1(C)
                self.matrix[3][1] = 1.0;
                self.matrix[3][2] = 1.0;
                self.matrix[1][0] = 1.0;
                self.matrix[2][0] = 1.0;
                self.carriers = 0b0001;
            }
            5 => {
                // 3->2->1(C), 4 feedback carrier
                self.matrix[2][1] = 1.0;
                self.matrix[1][0] = 1.0;
                self.ops[3].feedback = 0.5;
                self.carriers = 0b1001;
            }
            6 => {
                // Stack with feedback: 4(fb)->3->2->1(C)
                self.matrix[3][2] = 1.0;
                self.matrix[2][1] = 1.0;
                self.matrix[1][0] = 1.0;
                self.ops[3].feedback = 0.7;
                self.carriers = 0b0001;
            }
            _ => {
                // 2->1(C), 3(C), 4(C) -- one modulated + two additive
                self.matrix[1][0] = 1.0;
                self.carriers = 0b1101;
            }
        }
    }

    pub fn set_ratio(&mut self, op: usize, ratio: f32) {
        if op < 4 { self.ops[op].ratio = ratio; }
    }

    pub fn set_level(&mut self, op: usize, level: f32) {
        if op < 4 { self.ops[op].level = level; }
    }

    pub fn set_feedback(&mut self, op: usize, amount: f32) {
        if op < 4 { self.ops[op].feedback = amount.clamp(0.0, 1.0); }
    }

    pub fn set_mod_amount(&mut self, from: usize, to: usize, amount: f32) {
        if from < 4 && to < 4 { self.matrix[from][to] = amount; }
    }

    /// Process one sample. Returns mono output.
    #[inline]
    pub fn tick(&mut self, base_freq: f32, sample_rate: f32) -> f32 {
        let mut outputs = [0.0f32; 4];

        // Process operators in reverse order (modulators first)
        // Use previous frame's outputs for modulation (1-sample delay, DX7-style)
        for i in (0..4).rev() {
            let mut mod_input = 0.0f32;
            for j in 0..4 {
                if self.matrix[j][i].abs() > 0.001 {
                    mod_input += outputs[j] * self.matrix[j][i] * TAU;
                }
            }
            outputs[i] = self.ops[i].tick(base_freq, sample_rate, mod_input);
        }

        // Sum carrier outputs
        let mut mix = 0.0f32;
        for i in 0..4 {
            if self.carriers & (1 << i) != 0 {
                mix += outputs[i];
            }
        }
        mix
    }
}
