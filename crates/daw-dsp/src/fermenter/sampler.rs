//! Sampler engine — plays wavetable data as sample playback.
//! Supports one-shot, looping, and ping-pong modes.
//! Start/end points and crossfade for seamless loops.

pub const SAMPLE_BUFFER_SIZE: usize = 44100; // 1 second at 44.1kHz

#[derive(Clone, Copy, PartialEq)]
pub enum PlaybackMode {
    OneShot,  // Play once, stop at end
    Loop,     // Loop between start and end
    PingPong, // Bounce between start and end
}

#[derive(Clone)]
pub struct SamplerEngine {
    /// Internal sample buffer (populated from wavetable or external source)
    buffer: Vec<f32>,
    /// Playback position (fractional for pitch shifting)
    position: f32,
    /// Playback rate (1.0 = original pitch)
    rate: f32,
    /// Playback direction (1.0 = forward, -1.0 = reverse in ping-pong)
    direction: f32,
    /// Loop start point (0-1 normalized)
    loop_start: f32,
    /// Loop end point (0-1 normalized)
    loop_end: f32,
    /// Playback mode
    mode: PlaybackMode,
    /// Whether currently playing
    active: bool,
    /// Crossfade length in samples for loop smoothing
    crossfade: usize,
}

impl SamplerEngine {
    pub fn new() -> Self {
        // Initialize with a saw-like waveform as default "sample"
        let mut buffer = vec![0.0f32; SAMPLE_BUFFER_SIZE];
        for i in 0..SAMPLE_BUFFER_SIZE {
            let t = i as f32 / SAMPLE_BUFFER_SIZE as f32;
            // Default: a decaying saw burst (interesting for percussion)
            let env = (-t * 8.0).exp();
            buffer[i] = (t * 440.0 * core::f32::consts::TAU).sin() * env;
        }

        Self {
            buffer,
            position: 0.0,
            rate: 1.0,
            direction: 1.0,
            loop_start: 0.0,
            loop_end: 1.0,
            mode: PlaybackMode::OneShot,
            active: false,
            crossfade: 64,
        }
    }

    pub fn set_mode(&mut self, mode: u8) {
        self.mode = match mode {
            1 => PlaybackMode::Loop,
            2 => PlaybackMode::PingPong,
            _ => PlaybackMode::OneShot,
        };
    }

    pub fn set_loop_points(&mut self, start: f32, end: f32) {
        self.loop_start = start.clamp(0.0, 0.99);
        self.loop_end = end.clamp(0.01, 1.0).max(self.loop_start + 0.01);
    }

    /// Start playback at a pitch ratio relative to the original.
    pub fn trigger(&mut self, pitch_ratio: f32) {
        self.rate = pitch_ratio;
        self.position = self.loop_start * self.buffer.len() as f32;
        self.direction = 1.0;
        self.active = true;
    }

    /// Retune the playback rate while sounding. `trigger` only seeds the rate;
    /// the voice refreshes it every sample so the computed pitch — coarse and
    /// fine offsets, MPE bend, glide, pitch modulation — reaches the engine.
    pub fn set_rate(&mut self, rate: f32) {
        self.rate = rate;
    }

    pub fn stop(&mut self) {
        self.active = false;
    }

    pub fn reset(&mut self) {
        self.position = 0.0;
        self.active = false;
        self.direction = 1.0;
    }

    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Linearly interpolate the buffer at a fractional position (wrapping).
    #[inline]
    fn read_interpolated(&self, pos: f32, buf_len: usize) -> f32 {
        let pos_i = pos as usize;
        let frac = pos - pos_i as f32;
        let idx0 = pos_i % buf_len;
        let idx1 = (pos_i + 1) % buf_len;
        self.buffer[idx0] * (1.0 - frac) + self.buffer[idx1] * frac
    }

    /// Process one sample. Returns the sample value.
    #[inline]
    pub fn tick(&mut self, _sample_rate: f32) -> f32 {
        if !self.active {
            return 0.0;
        }

        let buf_len = self.buffer.len();
        let pos_f = self.position;

        let start_sample = self.loop_start * buf_len as f32;
        let end_sample = self.loop_end * buf_len as f32;

        // Read the sample at the current position (linear interpolation).
        let mut sample = self.read_interpolated(pos_f, buf_len);

        // Crossfade loop seams: in Loop mode, as the cursor enters the last
        // `crossfade` samples before the loop end, blend in the sample that the
        // wrapped cursor will read just after the start point. This removes the
        // hard discontinuity at the loop boundary that would otherwise click.
        // No allocation and a bounded number of reads — RT-safe.
        if self.mode == PlaybackMode::Loop && self.crossfade > 0 {
            let xf = self.crossfade as f32;
            let dist_to_end = end_sample - pos_f;
            if dist_to_end > 0.0 && dist_to_end < xf {
                // 0.0 at the start of the fade region, 1.0 right at the end.
                let t = 1.0 - (dist_to_end / xf);
                // Position the wrapped cursor would land on after looping.
                let wrap_pos = start_sample + (xf - dist_to_end);
                let wrapped = self.read_interpolated(wrap_pos, buf_len);
                // Equal-power crossfade keeps perceived loudness across the seam.
                let angle = t * core::f32::consts::FRAC_PI_2;
                let (sin_t, cos_t) = angle.sin_cos();
                sample = sample * cos_t + wrapped * sin_t;
            }
        }

        // De-click the one-shot endpoint: the cursor stops dead at
        // `end_sample`, so the last `crossfade` samples approaching it fade
        // the output towards zero. Without this, stopping on a non-zero
        // source frame is a hard cut — the same click the loop crossfade
        // above exists to remove. Same knob, same bounded cost — RT-safe.
        if self.mode == PlaybackMode::OneShot && self.crossfade > 0 {
            let dist_to_end = end_sample - pos_f;
            if dist_to_end < self.crossfade as f32 {
                sample *= (dist_to_end / self.crossfade as f32).max(0.0);
            }
        }

        // Advance position
        self.position += self.rate * self.direction;

        match self.mode {
            PlaybackMode::OneShot => {
                if self.position >= end_sample {
                    self.active = false;
                }
            }
            PlaybackMode::Loop => {
                if self.position >= end_sample {
                    self.position = start_sample + (self.position - end_sample);
                }
            }
            PlaybackMode::PingPong => {
                if self.direction > 0.0 && self.position >= end_sample {
                    self.direction = -1.0;
                    self.position = end_sample - (self.position - end_sample);
                } else if self.direction < 0.0 && self.position <= start_sample {
                    self.direction = 1.0;
                    self.position = start_sample + (start_sample - self.position);
                }
            }
        }

        sample
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a sampler whose loop region is a hard step: every sample in the
    /// first half holds `head`, every sample in the second half holds `tail`.
    /// Looping over the whole buffer therefore produces a `tail -> head`
    /// discontinuity at the seam — exactly what a loop crossfade must smooth.
    fn stepped_sampler(head: f32, tail: f32, crossfade: usize) -> SamplerEngine {
        let mut s = SamplerEngine::new();
        let n = s.buffer.len();
        for (i, v) in s.buffer.iter_mut().enumerate() {
            *v = if i < n / 2 { head } else { tail };
        }
        s.crossfade = crossfade;
        s.set_mode(1); // Loop
        s.set_loop_points(0.0, 1.0);
        s.trigger(1.0);
        s
    }

    /// Regression: with a non-zero crossfade, the samples in the fade region
    /// just before the loop end blend the tail toward the wrapped head instead
    /// of holding the raw tail value. Before the fix `crossfade` was never read,
    /// so every tick returned the raw buffer value and this blend never happened.
    #[test]
    fn loop_crossfade_blends_tail_toward_head() {
        let head = 1.0f32;
        let tail = -1.0f32;
        let xf = 64usize;

        // With crossfade active, run until the cursor is inside the fade region
        // (last `xf` samples before the loop end) and capture an output sample.
        let mut faded = stepped_sampler(head, tail, xf);
        let n = faded.buffer.len();
        let end = n as f32;
        let mut faded_sample = tail;
        let mut sampled_in_region = false;
        for _ in 0..n {
            let pos = faded.position;
            let s = faded.tick(44100.0);
            let dist = end - pos;
            // Pick a sample roughly mid-fade so the blend is clearly partial.
            if dist > 0.0 && dist < xf as f32 && dist <= (xf as f32) * 0.5 {
                faded_sample = s;
                sampled_in_region = true;
                break;
            }
        }
        assert!(sampled_in_region, "cursor never entered the fade region");

        // The raw tail value is exactly `tail`; a correct crossfade pulls it
        // toward `head`, so the output must sit strictly between them.
        assert!(
            faded_sample > tail + 1e-4,
            "fade output {faded_sample} did not move off the raw tail {tail}"
        );
        assert!(
            faded_sample < head,
            "fade output {faded_sample} overshot the wrapped head {head}"
        );

        // Control: with crossfade disabled the same position reads the raw tail.
        let mut plain = stepped_sampler(head, tail, 0);
        let mut plain_sample = head;
        for _ in 0..n {
            let pos = plain.position;
            let s = plain.tick(44100.0);
            let dist = end - pos;
            if dist > 0.0 && dist < xf as f32 && dist <= (xf as f32) * 0.5 {
                plain_sample = s;
                break;
            }
        }
        assert!(
            (plain_sample - tail).abs() < 1e-6,
            "with crossfade off the tail must read raw {tail}, got {plain_sample}"
        );
    }

    /// Outside the fade region the crossfade must not alter the signal: a sample
    /// read well before the loop end equals the raw buffer value regardless of
    /// the crossfade length. Guards against the blend leaking into the body.
    #[test]
    fn loop_crossfade_leaves_body_untouched() {
        let head = 1.0f32;
        let tail = -1.0f32;
        let xf = 64usize;

        let mut faded = stepped_sampler(head, tail, xf);
        let n = faded.buffer.len();
        let end = n as f32;

        // The very first tick is at position start (head region), far from the
        // seam, so the crossfade branch is inactive and the output is raw head.
        let first = faded.tick(44100.0);
        assert!(
            (first - head).abs() < 1e-6,
            "body sample altered by crossfade: expected {head}, got {first}"
        );
        // Sanity: that first read was indeed outside the fade region.
        assert!(end - 0.0 >= xf as f32);
    }

    /// Regression (one-shot ignored the End control): a one-shot with
    /// End = 0.25 must terminate at the selected endpoint — 11,025 source
    /// frames of the 1-second buffer — not run to the buffer end. Everything
    /// past the endpoint carries a sentinel amplitude, so any source content
    /// read beyond it is loud and obvious.
    #[test]
    fn one_shot_terminates_at_the_end_point_and_emits_nothing_past_it() {
        let mut s = SamplerEngine::new();
        let n = s.buffer.len();
        let end_frame = n / 4; // 0.25 × 44_100 = 11_025
        for (i, v) in s.buffer.iter_mut().enumerate() {
            *v = if i < end_frame { 1.0 } else { 7.0 };
        }
        s.set_mode(0); // OneShot
        s.set_loop_points(0.0, 0.25);
        s.trigger(1.0);

        let mut outputs = Vec::new();
        while s.is_active() {
            outputs.push(s.tick(44_100.0));
        }
        assert_eq!(
            outputs.len(),
            end_frame,
            "one-shot with End=0.25 must emit one frame per source frame up to the endpoint"
        );
        let loudest = outputs.iter().fold(0.0f32, |m, v| m.max(v.abs()));
        assert!(
            loudest <= 1.0 + 1e-4,
            "source content past the endpoint leaked: max |sample| {loudest} against a 7.0 sentinel"
        );
        for _ in 0..16 {
            assert_eq!(
                s.tick(44_100.0),
                0.0,
                "one-shot kept sounding after the endpoint"
            );
        }
    }

    /// The stop at the endpoint must be de-clicked: on a constant full-scale
    /// source the final samples fade to zero instead of jumping from the
    /// endpoint amplitude straight to silence.
    #[test]
    fn one_shot_declicks_at_the_end_point() {
        let mut s = SamplerEngine::new();
        for v in s.buffer.iter_mut() {
            *v = 1.0;
        }
        s.set_mode(0); // OneShot
        s.set_loop_points(0.0, 0.25);
        s.trigger(1.0);

        let mut outputs = Vec::new();
        while s.is_active() {
            outputs.push(s.tick(44_100.0));
        }
        let worst_jump = outputs
            .windows(2)
            .map(|w| (w[0] - w[1]).abs())
            .fold(0.0f32, f32::max);
        let final_sample = outputs[outputs.len() - 1].abs();
        assert!(
            worst_jump < 0.05 && final_sample < 0.05,
            "one-shot stopped with a discontinuity: largest in-stream jump \
             {worst_jump}, final sample {final_sample} against a full-scale source"
        );
    }

    /// Loop modes keep their existing endpoint semantics: Loop still wraps at
    /// the loop end and PingPong still bounces, and neither stops there — the
    /// one-shot endpoint fix must not leak into them.
    #[test]
    fn loop_modes_keep_playing_at_the_loop_end() {
        let region_ticks = 2 * SAMPLE_BUFFER_SIZE;

        let mut looper = stepped_sampler(1.0, -1.0, 0);
        looper.set_loop_points(0.0, 0.5);
        looper.trigger(1.0);
        let loop_end = 0.5 * looper.buffer.len() as f32;
        let mut furthest = 0.0f32;
        for _ in 0..region_ticks {
            looper.tick(44_100.0);
            furthest = furthest.max(looper.position);
        }
        assert!(looper.is_active(), "loop mode stopped at the loop end");
        assert!(
            furthest < loop_end + 1.0,
            "loop cursor escaped the loop region: {furthest} past {loop_end}"
        );

        let mut pinger = stepped_sampler(1.0, -1.0, 0);
        pinger.set_mode(2); // PingPong
        pinger.set_loop_points(0.0, 0.5);
        pinger.trigger(1.0);
        for _ in 0..region_ticks {
            pinger.tick(44_100.0);
        }
        assert!(pinger.is_active(), "ping-pong stopped at a region bound");
    }
}
