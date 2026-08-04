//! Orchestral realism layer.
//!
//! Augments the sample-based Levain engine with the physical-modeling
//! artifacts of orchestral realism: parametric body resonance bank,
//! open-string sympathetic resonators, bow-noise + release noise burst,
//! breath/reed air noise, and frequency-dependent damping.
//!
//! Topology: the engine sums all voices into a mono bridge signal, applies
//! `RealismEngine::tick` to that signal, then feeds the result into the mic
//! mixer for stereo placement. The realism layer is always on; it
//! configures itself from the instrument identity that the engine receives
//! from the loader and runs hard-wired afterwards. There are no user-facing
//! tunables — every level here is a fixed property of "this is a violin"
//! (or cello, or trumpet, …). All processing is allocation-free and safe
//! to call from the audio hot path.

pub mod biquad;
pub mod body;
pub mod bow_noise;
pub mod breath_noise;
pub mod damping;
pub mod sympathetic;

use body::{BodyPreset, BodyResonator};
use bow_noise::BowNoise;
use breath_noise::{BreathNoise, BreathPreset};
use damping::DampingFilter;
use sympathetic::{SympatheticBank, SympatheticPreset};

/// Recognised instrument identities. Mirrors the granularity of the
/// frontend's `InstrumentId` strings (`violin-1`, `cello`, `trumpet`, …)
/// — exactly what the loader knows about the loaded sample bank. The enum
/// is private to the realism module; nothing else in the engine needs to
/// branch on instrument identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Instrument {
    Violin,
    Viola,
    Cello,
    Bass,
    Trumpet,
    Horn,
    Trombone,
    Tuba,
    Flute,
    Piccolo,
    Oboe,
    EnglishHorn,
    Clarinet,
    BassClarinet,
    Bassoon,
    Contrabassoon,
    Other,
}

impl Instrument {
    /// Parse the frontend `instrumentId` slug. Mirrors `getInstrumentFamily`
    /// in `src/modules/Levain/models/LevainPatch.ts` so that adding a new
    /// instrument id on either side is a one-place change.
    fn from_id(id: &str) -> Self {
        // Choir voices first so "bass-voice" doesn't match "bass".
        if matches!(id, "soprano" | "alto" | "tenor" | "bass-voice") {
            return Instrument::Other;
        }
        // Woodwinds before brass so "english-horn" doesn't match "horn".
        if id.contains("piccolo") {
            return Instrument::Piccolo;
        }
        if id.contains("flute") {
            return Instrument::Flute;
        }
        if id == "english-horn" {
            return Instrument::EnglishHorn;
        }
        if id == "bass-clarinet" {
            return Instrument::BassClarinet;
        }
        if id.contains("clarinet") {
            return Instrument::Clarinet;
        }
        if id == "contrabassoon" {
            return Instrument::Contrabassoon;
        }
        if id.contains("bassoon") {
            return Instrument::Bassoon;
        }
        if id.contains("oboe") {
            return Instrument::Oboe;
        }
        // Strings.
        if id.contains("violin") {
            return Instrument::Violin;
        }
        if id.contains("viola") {
            return Instrument::Viola;
        }
        if id.contains("cello") {
            return Instrument::Cello;
        }
        if id == "double-bass" {
            return Instrument::Bass;
        }
        // Brass.
        if id.contains("trumpet") {
            return Instrument::Trumpet;
        }
        if id.contains("trombone") {
            return Instrument::Trombone;
        }
        if id.contains("tuba") {
            return Instrument::Tuba;
        }
        if id == "horn" || id == "solo-horn" {
            return Instrument::Horn;
        }
        Instrument::Other
    }

    fn body(self) -> BodyPreset {
        match self {
            Instrument::Violin => BodyPreset::Violin,
            Instrument::Viola => BodyPreset::Viola,
            Instrument::Cello => BodyPreset::Cello,
            Instrument::Bass => BodyPreset::Bass,
            Instrument::Trumpet | Instrument::Horn | Instrument::Trombone | Instrument::Tuba => {
                BodyPreset::Brass
            }
            Instrument::Flute
            | Instrument::Piccolo
            | Instrument::Oboe
            | Instrument::EnglishHorn
            | Instrument::Clarinet
            | Instrument::BassClarinet
            | Instrument::Bassoon
            | Instrument::Contrabassoon => BodyPreset::Woodwind,
            Instrument::Other => BodyPreset::None,
        }
    }

    fn sympathetic(self) -> SympatheticPreset {
        match self {
            Instrument::Violin => SympatheticPreset::Violin,
            Instrument::Viola => SympatheticPreset::Viola,
            Instrument::Cello => SympatheticPreset::Cello,
            Instrument::Bass => SympatheticPreset::Bass,
            _ => SympatheticPreset::None,
        }
    }

    fn breath(self) -> BreathPreset {
        match self {
            Instrument::Trumpet | Instrument::Horn | Instrument::Trombone | Instrument::Tuba => {
                BreathPreset::Brass
            }
            Instrument::Flute | Instrument::Piccolo => BreathPreset::Flute,
            Instrument::Oboe
            | Instrument::EnglishHorn
            | Instrument::Bassoon
            | Instrument::Contrabassoon => BreathPreset::DoubleReed,
            Instrument::Clarinet | Instrument::BassClarinet => BreathPreset::SingleReed,
            _ => BreathPreset::None,
        }
    }

    fn is_bowed_string(self) -> bool {
        matches!(
            self,
            Instrument::Violin | Instrument::Viola | Instrument::Cello | Instrument::Bass
        )
    }

    fn is_wind(self) -> bool {
        matches!(
            self,
            Instrument::Trumpet
                | Instrument::Horn
                | Instrument::Trombone
                | Instrument::Tuba
                | Instrument::Flute
                | Instrument::Piccolo
                | Instrument::Oboe
                | Instrument::EnglishHorn
                | Instrument::Clarinet
                | Instrument::BassClarinet
                | Instrument::Bassoon
                | Instrument::Contrabassoon
        )
    }
}

/// The realism orchestrator. Always on. Configures itself from the
/// instrument identity that the loader gives the engine.
pub struct RealismEngine {
    instrument: Instrument,

    body: BodyResonator,
    sympathetic: SympatheticBank,
    bow_noise: BowNoise,
    breath: BreathNoise,
    damping: DampingFilter,
}

impl RealismEngine {
    pub fn new(sample_rate: f32) -> Self {
        let mut me = Self {
            instrument: Instrument::Other,
            body: BodyResonator::new(sample_rate),
            sympathetic: SympatheticBank::new(sample_rate),
            bow_noise: BowNoise::new(sample_rate),
            breath: BreathNoise::new(sample_rate),
            damping: DampingFilter::new(sample_rate),
        };
        // A sane neutral default until the loader tells us what we are.
        me.configure(Instrument::Other);
        me
    }

    /// Tell the realism layer which instrument it is now playing. Called
    /// once when the loader switches sample banks. Mix levels are fixed
    /// per instrument family — there is no user-facing knob.
    pub fn configure_for(&mut self, instrument_id: &str) {
        self.configure(Instrument::from_id(instrument_id));
    }

    #[cfg(test)]
    pub(crate) fn is_bowed_string_for_test(&self) -> bool {
        self.instrument.is_bowed_string()
    }

    fn configure(&mut self, instrument: Instrument) {
        self.instrument = instrument;
        self.body.set_preset(instrument.body());
        self.sympathetic.set_preset(instrument.sympathetic());
        self.breath.set_preset(instrument.breath());

        if instrument.is_bowed_string() {
            self.body.amount = 0.65;
            self.sympathetic.amount = 0.5;
            self.bow_noise.amount = 0.5;
            self.breath.amount = 0.0;
            self.damping.set_amount(0.4);
        } else if instrument.is_wind() {
            self.body.amount = 0.45;
            self.sympathetic.amount = 0.0;
            self.bow_noise.amount = 0.0;
            self.breath.amount = 0.55;
            self.damping.set_amount(0.0);
        } else {
            self.body.amount = 0.0;
            self.sympathetic.amount = 0.0;
            self.bow_noise.amount = 0.0;
            self.breath.amount = 0.0;
            self.damping.set_amount(0.0);
        }
    }

    pub fn reset(&mut self) {
        self.body.reset();
        self.sympathetic.reset();
        self.bow_noise.reset();
        self.breath.reset();
        self.damping.reset();
    }

    /// Forwarded from the engine's note_on. Triggers the bow-scrape onset
    /// burst on bowed strings.
    pub fn note_on(&mut self, _note: u8) {
        if self.instrument.is_bowed_string() {
            self.bow_noise.trigger_burst();
        }
    }

    /// Forwarded from the engine's note_off. Triggers the release noise
    /// burst on bowed strings (spec §8.2).
    pub fn note_off(&mut self, _note: u8) {
        if self.instrument.is_bowed_string() {
            self.bow_noise.trigger_burst();
        }
    }

    /// Update the dynamic-driven controls (CC1 for bow noise, CC11 for
    /// breath). Called once per audio block.
    pub fn update_expression(&mut self, cc1_normalized: f32, cc11_normalized: f32) {
        self.bow_noise.set_cc1(cc1_normalized);
        self.breath.level = cc11_normalized.clamp(0.0, 1.0);
    }

    /// Process one mono sample through the realism stack.
    ///
    /// `voices_active` gates the continuous bow/breath noise components so
    /// an idle instrument doesn't emit a persistent hiss. The release-burst
    /// contribution from `bow_noise` still fires when an active voice
    /// triggers it — its envelope is advanced inside `BowNoise::tick`.
    #[inline]
    pub fn tick(&mut self, mono_in: f32, voices_active: bool) -> f32 {
        // Frequency-dependent damping first (acts on the raw bridge signal).
        let damped = self.damping.tick(mono_in);

        // Add the air/bow noise BEFORE the body so the body resonances colour
        // them too — this is what makes added noise sit "inside" the
        // instrument instead of on top of it.
        let with_noise =
            damped + self.bow_noise.tick(voices_active) + self.breath.tick(voices_active);

        // Body colouration (parallel parametric bank).
        let bodied = self.body.tick(with_noise);

        // Sympathetic resonance excited by the bridge signal.
        self.sympathetic.tick(bodied)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Run the realism stack across one second of synthetic input for every
    /// recognised instrument and assert that nothing produces NaN/Inf and
    /// the RMS stays in a sane range. Catches coefficient regressions and
    /// numerical blow-ups (the kind of bug that doesn't show up in `cargo
    /// check` but does show up the first time someone hits play).
    #[test]
    fn realism_is_finite_for_every_instrument() {
        const SAMPLE_RATE: f32 = 48_000.0;
        const NUM_SAMPLES: usize = 48_000; // 1 s

        let ids = [
            "violin-1",
            "viola",
            "cello",
            "double-bass",
            "trumpet",
            "horn",
            "trombone",
            "tuba",
            "flute",
            "piccolo",
            "oboe",
            "english-horn",
            "clarinet",
            "bass-clarinet",
            "bassoon",
            "contrabassoon",
            "marimba", // -> Other, realism is effectively pass-through
        ];

        for id in ids {
            let mut realism = RealismEngine::new(SAMPLE_RATE);
            realism.configure_for(id);
            realism.update_expression(0.7, 0.8);
            realism.note_on(60);

            // Drive with a 220 Hz sine to give the body filters something
            // periodic to chew on.
            let mut sum_sq = 0.0_f64;
            for n in 0..NUM_SAMPLES {
                let phase = (n as f32) * 220.0 / SAMPLE_RATE;
                let input = (phase * std::f32::consts::TAU).sin() * 0.3;
                let out = realism.tick(input, true);
                assert!(
                    out.is_finite(),
                    "instrument {id}: non-finite output at sample {n}"
                );
                sum_sq += (out as f64) * (out as f64);
            }

            let rms = (sum_sq / NUM_SAMPLES as f64).sqrt() as f32;
            assert!(
                rms.is_finite() && rms < 5.0,
                "instrument {id}: RMS out of range ({rms})",
            );

            // Trigger a release burst and process another short window.
            realism.note_off(60);
            for _ in 0..4_800 {
                let _ = realism.tick(0.0, true);
            }
        }
    }

    /// With no active voices and zero input, the realism layer must be
    /// silent — this is the fix for the "constant white noise floor" bug
    /// where bow / breath noise generators emitted bandpassed white noise
    /// unconditionally, audible as soon as a Levain track was loaded.
    /// Pass-through filters (body / sympathetic / damping) carry no energy
    /// on zero input so the overall output must be exactly zero.
    #[test]
    fn realism_is_silent_when_no_voices_active() {
        const SAMPLE_RATE: f32 = 48_000.0;
        const NUM_SAMPLES: usize = 48_000;

        let families = ["violin-1", "flute", "trumpet", "clarinet", "marimba"];
        for id in families {
            let mut realism = RealismEngine::new(SAMPLE_RATE);
            realism.configure_for(id);
            realism.update_expression(0.8, 1.0);
            for n in 0..NUM_SAMPLES {
                let out = realism.tick(0.0, false);
                assert_eq!(
                    out, 0.0,
                    "instrument {id}: emitted {out} at sample {n} with no voices active",
                );
            }
        }
    }

    /// `Instrument::from_id` must agree with `getInstrumentFamily` in
    /// `LevainPatch.ts` for every recognised slug — if a new instrument
    /// id is added on either side, this test should remind us to keep
    /// the two parsers in sync.
    #[test]
    fn instrument_id_parsing() {
        assert_eq!(Instrument::from_id("violin-1"), Instrument::Violin);
        assert_eq!(Instrument::from_id("solo-violin"), Instrument::Violin);
        assert_eq!(Instrument::from_id("viola"), Instrument::Viola);
        assert_eq!(Instrument::from_id("cello"), Instrument::Cello);
        assert_eq!(Instrument::from_id("solo-cello"), Instrument::Cello);
        assert_eq!(Instrument::from_id("double-bass"), Instrument::Bass);

        assert_eq!(Instrument::from_id("trumpet"), Instrument::Trumpet);
        assert_eq!(Instrument::from_id("solo-trumpet"), Instrument::Trumpet);
        assert_eq!(Instrument::from_id("horn"), Instrument::Horn);
        assert_eq!(Instrument::from_id("solo-horn"), Instrument::Horn);
        assert_eq!(Instrument::from_id("trombone"), Instrument::Trombone);
        assert_eq!(Instrument::from_id("tuba"), Instrument::Tuba);

        assert_eq!(Instrument::from_id("flute"), Instrument::Flute);
        assert_eq!(Instrument::from_id("piccolo"), Instrument::Piccolo);
        assert_eq!(Instrument::from_id("oboe"), Instrument::Oboe);
        // english-horn must NOT be parsed as plain horn.
        assert_eq!(Instrument::from_id("english-horn"), Instrument::EnglishHorn);
        // bass-clarinet must NOT be parsed as plain clarinet.
        assert_eq!(
            Instrument::from_id("bass-clarinet"),
            Instrument::BassClarinet
        );
        assert_eq!(Instrument::from_id("clarinet"), Instrument::Clarinet);
        assert_eq!(
            Instrument::from_id("contrabassoon"),
            Instrument::Contrabassoon
        );
        assert_eq!(Instrument::from_id("bassoon"), Instrument::Bassoon);

        // Choir voices and percussion fall through to Other.
        assert_eq!(Instrument::from_id("bass-voice"), Instrument::Other);
        assert_eq!(Instrument::from_id("soprano"), Instrument::Other);
        assert_eq!(Instrument::from_id("timpani"), Instrument::Other);
        assert_eq!(Instrument::from_id("marimba"), Instrument::Other);
        assert_eq!(Instrument::from_id("garbage"), Instrument::Other);
    }

    /// The bow-noise burst envelope should rise from 0, peak near `t = τ`,
    /// then decay — not just decay monotonically as the previous one-pole
    /// implementation did.
    #[test]
    fn bow_noise_burst_rises_then_falls() {
        use bow_noise::BowNoise;

        const SAMPLE_RATE: f32 = 48_000.0;
        let mut bow = BowNoise::new(SAMPLE_RATE);
        bow.amount = 1.0;
        bow.set_cc1(0.0); // disable the continuous component
        bow.trigger_burst();

        // Sample the absolute envelope by feeding zeros and tracking the
        // peak position. We feed enough samples to cover ~5 ms × 4.
        let mut peak_value = 0.0_f32;
        let mut peak_index = 0_usize;
        for n in 0..960 {
            let v = bow.tick(true).abs();
            if v > peak_value {
                peak_value = v;
                peak_index = n;
            }
        }

        // τ = 5 ms = 240 samples at 48 kHz. The peak of t·exp(−t/τ) is at
        // t = τ. The bandpassed noise modulates the envelope so the peak
        // index isn't exact, but it should be within ±50% of τ — and it
        // must NOT be at sample 0 (which is what a monotonic decay would
        // give).
        let tau_samples = 240_usize;
        assert!(
            peak_index > 30,
            "burst peak at {peak_index} — looks monotonic"
        );
        assert!(
            peak_index < tau_samples * 2,
            "burst peak at {peak_index} — too late for τ = {tau_samples}",
        );
        assert!(peak_value > 0.0);
    }

    /// The body bank should actually boost at its tabled mode frequencies.
    /// This pins the post-fix behaviour where each peaking biquad
    /// contributes its full per-mode `gain_db` (not the averaged-down
    /// value the previous topology produced) — and would catch a
    /// regression to "average then mix" or to a body filter that quietly
    /// stops resonating.
    #[test]
    fn body_bank_boosts_at_mode_frequencies() {
        use body::{BodyPreset, BodyResonator};

        const SAMPLE_RATE: f32 = 48_000.0;

        // Pick a violin mode well clear of DC and Nyquist (524 Hz from
        // the Princeton table).
        const PROBE_HZ: f32 = 524.0;
        const NUM_SAMPLES: usize = 4_800; // 100 ms — long enough to settle.

        let mut bank = BodyResonator::new(SAMPLE_RATE);
        bank.set_preset(BodyPreset::Violin);
        bank.amount = 1.0;

        // RMS of input vs output at the probe frequency.
        let mut in_sq = 0.0_f64;
        let mut out_sq = 0.0_f64;
        // Discard the first 25 ms so the filter is past its transient.
        let warmup = (SAMPLE_RATE * 0.025) as usize;
        for n in 0..(NUM_SAMPLES + warmup) {
            let phase = (n as f32) * PROBE_HZ / SAMPLE_RATE;
            let x = (phase * std::f32::consts::TAU).sin();
            let y = bank.tick(x);
            if n >= warmup {
                in_sq += (x as f64) * (x as f64);
                out_sq += (y as f64) * (y as f64);
            }
        }
        let gain_lin = (out_sq / in_sq).sqrt() as f32;
        // The 524 Hz mode has gain_db = 4.0 (≈ 1.585×). With other modes
        // contributing roughly unity at that frequency, the bank should
        // boost noticeably above 1.0 — assert >1.2 to give margin for
        // bandwidth-driven smearing while still failing if the topology
        // regresses to "averaged then mixed".
        assert!(
            gain_lin > 1.2,
            "body bank gain at {PROBE_HZ} Hz = {gain_lin}, expected > 1.2",
        );
    }

    /// Per-voice vibrato must (a) actually modulate `playback.speed` away
    /// from `base_speed` when depth > 0, (b) leave it alone at depth = 0,
    /// (c) ramp in over the onset delay, and (d) produce different speed
    /// values for two voices that started with different phases — the
    /// ensemble decorrelation guarantee from spec §4.2.
    ///
    /// This test exercises the voice path directly so it does not depend
    /// on having any sample bank loaded.
    #[test]
    fn vibrato_modulates_speed_and_decorrelates_voices() {
        use super::super::types::*;
        use super::super::voice::LevainVoice;
        use super::super::zone::SamplePool;

        const SAMPLE_RATE: f32 = 48_000.0;
        const BLOCK: usize = 128;
        // Spec §7.1 typical violin vibrato.
        const RATE_HZ: f32 = 5.5;
        const DEPTH_CENTS: f32 = 25.0;

        // Build a minimal sample pool + zone so trigger() has something
        // to configure the voice's playback against.
        let mut pool = SamplePool::new();
        let sample_id = pool
            .add(vec![0.0; 4096], 4096, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        let zone = Zone {
            id: 0,
            key: KeyRange { lo: 0, hi: 127 },
            vel: VelRange { lo: 0, hi: 127 },
            articulation: 0,
            rr_pos: 0,
            rr_len: 1,
            mic: 0,
            is_release: false,
            sample: SampleRef {
                sample_id,
                root_key: 60,
                tune_cents: 0,
                start: 0,
                end: 0,
                loop_mode: LoopMode::NoLoop,
                loop_start: 0,
                loop_end: 0,
                loop_crossfade: 0,
            },
            amp_env: AdsrParams::default(),
            gain_db: 0.0,
        };

        let mut voice_a = LevainVoice::new(SAMPLE_RATE);
        let mut voice_b = LevainVoice::new(SAMPLE_RATE);
        voice_a.trigger(60, 0, 100, &zone, 0, 1.0, &pool);
        voice_b.trigger(60, 0, 100, &zone, 0, 1.0, &pool);
        voice_a.vibrato_phase = 0.10;
        voice_b.vibrato_phase = 0.60; // 180° from a after sin
        voice_a.vibrato_rate_scale = 1.0;
        voice_b.vibrato_rate_scale = 1.0;

        // Both voices should start at base_speed = 1.0 (note 60 == root).
        assert!((voice_a.playback.base_speed - 1.0).abs() < 1e-6);
        assert!((voice_a.playback.speed - 1.0).abs() < 1e-6);

        // Step 1: depth = 0 → speed must equal base_speed exactly.
        voice_a.update_vibrato_block(0.0, RATE_HZ, 0.0, SAMPLE_RATE, BLOCK);
        assert_eq!(voice_a.playback.speed, voice_a.playback.base_speed);

        // Step 2: drive past the onset window so the depth has ramped to
        // full. samples_since_on increments only inside `tick`, so fake it
        // by hand for the test.
        voice_a.samples_since_on = SAMPLE_RATE as u32; // 1 s
        voice_b.samples_since_on = SAMPLE_RATE as u32;

        voice_a.update_vibrato_block(DEPTH_CENTS, RATE_HZ, 0.2, SAMPLE_RATE, BLOCK);
        voice_b.update_vibrato_block(DEPTH_CENTS, RATE_HZ, 0.2, SAMPLE_RATE, BLOCK);

        // (a) speed must have moved off base_speed for at least one of the
        // two voices (sin can be 0 at exactly one phase; we picked phases
        // such that this doesn't happen for both).
        let moved_a = (voice_a.playback.speed - voice_a.playback.base_speed).abs() > 1e-6;
        let moved_b = (voice_b.playback.speed - voice_b.playback.base_speed).abs() > 1e-6;
        assert!(
            moved_a || moved_b,
            "vibrato did not perturb playback speed: a={} b={}",
            voice_a.playback.speed,
            voice_b.playback.speed,
        );

        // (b) the two voices' speeds must differ — that's the
        // decorrelation guarantee.
        assert!(
            (voice_a.playback.speed - voice_b.playback.speed).abs() > 1e-6,
            "voice A and B have identical speed {} — not decorrelated",
            voice_a.playback.speed,
        );

        // (c) speed magnitude is bounded by 2^(±25/1200) ≈ 0.985..1.015,
        // a sanity check that the math is correct, not blown up.
        let max_dev = 0.025_f64;
        for v in [&voice_a, &voice_b] {
            let dev = (v.playback.speed - 1.0).abs();
            assert!(
                dev < max_dev,
                "vibrato deviation {} too large for ±25 cent depth",
                dev,
            );
        }

        // (d) at depth 0 with a voice that previously had non-zero
        // modulation, the next call must restore base_speed.
        voice_a.update_vibrato_block(0.0, RATE_HZ, 0.0, SAMPLE_RATE, BLOCK);
        assert!((voice_a.playback.speed - voice_a.playback.base_speed).abs() < 1e-6);
    }

    /// Vibrato should ramp in over the configured onset delay (spec §7.3),
    /// not appear instantly. The previous test set `samples_since_on` past
    /// the ramp so this branch was uncovered — this one starts at zero.
    #[test]
    fn vibrato_onset_ramps_in() {
        use super::super::types::*;
        use super::super::voice::LevainVoice;
        use super::super::zone::SamplePool;

        const SAMPLE_RATE: f32 = 48_000.0;
        const BLOCK: usize = 128;
        const RATE_HZ: f32 = 5.5;
        const DEPTH_CENTS: f32 = 25.0;
        const ONSET_SECS: f32 = 0.2;

        let mut pool = SamplePool::new();
        let sample_id = pool
            .add(vec![0.0; 4096], 4096, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        let zone = Zone {
            id: 0,
            key: KeyRange { lo: 0, hi: 127 },
            vel: VelRange { lo: 0, hi: 127 },
            articulation: 0,
            rr_pos: 0,
            rr_len: 1,
            mic: 0,
            is_release: false,
            sample: SampleRef {
                sample_id,
                root_key: 60,
                tune_cents: 0,
                start: 0,
                end: 0,
                loop_mode: LoopMode::NoLoop,
                loop_start: 0,
                loop_end: 0,
                loop_crossfade: 0,
            },
            amp_env: AdsrParams::default(),
            gain_db: 0.0,
        };

        let mut voice = LevainVoice::new(SAMPLE_RATE);
        voice.trigger(60, 0, 100, &zone, 0, 1.0, &pool);
        // Force a phase that gives a non-zero sin so onset is the only
        // thing keeping the modulation small.
        voice.vibrato_phase = 0.25; // sin(2π·0.25) = 1.0

        // At samples_since_on = 0 the onset gain is 0 — modulation must
        // be effectively zero even with full depth requested.
        voice.samples_since_on = 0;
        voice.update_vibrato_block(DEPTH_CENTS, RATE_HZ, ONSET_SECS, SAMPLE_RATE, BLOCK);
        let speed_at_zero = voice.playback.speed;
        assert!(
            (speed_at_zero - voice.playback.base_speed).abs() < 1e-5,
            "onset_gain should be 0 at samples_since_on=0, got speed {speed_at_zero}",
        );

        // Halfway through the ramp (~100 ms = 4800 samples), the onset
        // gain should be ≈ 0.5 → modulation about half its full value.
        voice.vibrato_phase = 0.25;
        voice.samples_since_on = (SAMPLE_RATE * ONSET_SECS * 0.5) as u32;
        voice.update_vibrato_block(DEPTH_CENTS, RATE_HZ, ONSET_SECS, SAMPLE_RATE, BLOCK);
        let speed_at_half = voice.playback.speed;
        let dev_half = (speed_at_half - voice.playback.base_speed).abs() as f32;

        // Past the ramp (>= 200 ms), full depth.
        voice.vibrato_phase = 0.25;
        voice.samples_since_on = (SAMPLE_RATE * ONSET_SECS * 2.0) as u32;
        voice.update_vibrato_block(DEPTH_CENTS, RATE_HZ, ONSET_SECS, SAMPLE_RATE, BLOCK);
        let speed_at_full = voice.playback.speed;
        let dev_full = (speed_at_full - voice.playback.base_speed).abs() as f32;

        // Half-ramp deviation should be roughly half the full deviation
        // and clearly larger than the zero-onset deviation.
        assert!(
            dev_half > 0.0 && dev_half < dev_full,
            "onset ramp not monotonic: zero={}, half={}, full={}",
            (speed_at_zero - voice.playback.base_speed).abs(),
            dev_half,
            dev_full,
        );
        // The half/full ratio should be close to 0.5 — give wide margin
        // because phase advances slightly between calls.
        let ratio = dev_half / dev_full;
        assert!(
            (0.35..=0.65).contains(&ratio),
            "ramp ratio at half-onset = {ratio} (expected ~0.5)",
        );
    }

    /// Phase wrap branch — make sure a voice that runs long enough to
    /// wrap its phase past 1.0 doesn't blow up. Uses an extreme rate so
    /// the wrap actually fires within a few blocks.
    #[test]
    fn vibrato_phase_wraps_cleanly() {
        use super::super::types::*;
        use super::super::voice::LevainVoice;
        use super::super::zone::SamplePool;

        const SAMPLE_RATE: f32 = 48_000.0;
        const BLOCK: usize = 128;

        let mut pool = SamplePool::new();
        let sample_id = pool
            .add(vec![0.0; 4096], 4096, 1, SAMPLE_RATE)
            .expect("test sample should fit the bank");
        let zone = Zone {
            id: 0,
            key: KeyRange { lo: 0, hi: 127 },
            vel: VelRange { lo: 0, hi: 127 },
            articulation: 0,
            rr_pos: 0,
            rr_len: 1,
            mic: 0,
            is_release: false,
            sample: SampleRef {
                sample_id,
                root_key: 60,
                tune_cents: 0,
                start: 0,
                end: 0,
                loop_mode: LoopMode::NoLoop,
                loop_start: 0,
                loop_end: 0,
                loop_crossfade: 0,
            },
            amp_env: AdsrParams::default(),
            gain_db: 0.0,
        };

        let mut voice = LevainVoice::new(SAMPLE_RATE);
        voice.trigger(60, 0, 100, &zone, 0, 1.0, &pool);
        voice.samples_since_on = SAMPLE_RATE as u32;
        voice.vibrato_phase = 0.95;

        // 200 blocks at any reasonable rate is more than enough to wrap
        // the phase several times. Assert the phase stays in [0, 1) and
        // the speed never goes non-finite or unbounded.
        for _ in 0..200 {
            voice.update_vibrato_block(25.0, 5.5, 0.2, SAMPLE_RATE, BLOCK);
            assert!(
                (0.0..1.0).contains(&voice.vibrato_phase),
                "vibrato_phase out of range: {}",
                voice.vibrato_phase,
            );
            assert!(
                voice.playback.speed.is_finite(),
                "playback.speed not finite: {}",
                voice.playback.speed,
            );
            assert!(
                voice.playback.speed > 0.5 && voice.playback.speed < 2.0,
                "playback.speed wandered: {}",
                voice.playback.speed,
            );
        }
    }

    /// Sympathetic bandpass filters at the higher Q must remain stable —
    /// the test catches the case where someone bumps Q past the
    /// numerical-stability ceiling at single precision.
    #[test]
    fn sympathetic_bank_is_stable_at_high_q() {
        use sympathetic::{SympatheticBank, SympatheticPreset};

        for sr in [44_100.0_f32, 48_000.0, 88_200.0, 96_000.0] {
            let mut bank = SympatheticBank::new(sr);
            bank.set_preset(SympatheticPreset::Bass); // lowest fundamentals = hardest
            bank.amount = 1.0;

            // Excite with a unit impulse and run for a couple of seconds.
            let mut last = 0.0_f32;
            for n in 0..(sr as usize * 2) {
                let input = if n == 0 { 1.0 } else { 0.0 };
                last = bank.tick(input);
                assert!(last.is_finite(), "sr={sr}: non-finite at n={n}");
            }
            // After 2 s the resonator should have decayed substantially.
            assert!(last.abs() < 1.0, "sr={sr}: bank not decaying ({last})");
        }
    }
}
