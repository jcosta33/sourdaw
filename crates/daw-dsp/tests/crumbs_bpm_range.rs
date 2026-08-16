//! Auto-BPM must be able to report the slowest tempo it claims to cover
//! (audit F11).
//!
//! `estimate_bpm` fills its autocorrelation over `min_lag..=max_lag`, where
//! `max_lag` is the lag `MIN_BPM` resolves to, and then scanned for the peak
//! over `(min_lag + 1)..max_lag` — exclusive. The slowest tempo in the declared
//! range was therefore the one lag the detector could never return, and a loop
//! recorded at it was reported at some faster lag inside the scan or dropped
//! for want of a positive peak.
//!
//! The fixture is an accented click track at exactly `MIN_BPM`, i.e. one loud
//! click per second with a quieter one between, which puts the strongest
//! periodicity precisely on the excluded lag and a weaker competitor at half
//! it.

use daw_dsp::crumbs::analysis::bpm::estimate_bpm;

/// The onset config's own default rate. `estimate_bpm` derives its lag range
/// from `sample_rate / hop_size`, so the fixture is built at the same rate the
/// analysis assumes rather than resampled into it.
const SAMPLE_RATE: u32 = 44_100;
/// The bottom of the detector's declared range.
const MIN_BPM: f32 = 60.0;
/// Eight clicks: long enough that the autocorrelation at a one-second lag has
/// most of the signal overlapping itself, and that the ODF is at least twice
/// `max_lag` long — below that, `max_lag` is clamped to half the ODF and the
/// fixture would stop sitting on the boundary it exists to test.
const CLICKS: usize = 8;
const CLICK_FRAMES: usize = 900;

/// A click track at `bpm` with a quieter click on every off-beat — accented
/// eighth notes, the plainest rhythm there is. Each click is a decaying 2 kHz
/// burst with an instantaneous attack, which is what a spectral-flux onset
/// detector is built to find.
///
/// The off-beats are what make the fixture decide something. A bare click
/// track's autocorrelation has one broad peak at the beat, and the parabolic
/// refinement that follows the peak scan reads `acf[best_lag + 1]` — so even a
/// scan that stops one lag short is pulled back onto the true period by the
/// neighbour it can still see, and the boundary goes untested. With accents,
/// the autocorrelation carries a second, genuinely weaker peak at the off-beat
/// period: a scan that cannot reach the true lag settles on that instead and
/// reports twice the tempo, which no amount of sub-lag refinement recovers.
fn click_track(bpm: f32) -> Vec<f32> {
    const OFFBEAT_LEVEL: f32 = 0.45;

    let period = (SAMPLE_RATE as f32 * 60.0 / bpm).round() as usize;
    let mut samples = vec![0.0_f32; period * CLICKS];
    let place = |start: usize, level: f32, samples: &mut Vec<f32>| {
        for frame in 0..CLICK_FRAMES {
            let t = frame as f32 / SAMPLE_RATE as f32;
            let decay = (-t * 220.0).exp();
            let phase = t * 2_000.0 * std::f32::consts::TAU;
            samples[start + frame] = phase.sin() * decay * level;
        }
    };
    for click in 0..CLICKS {
        let start = click * period;
        place(start, 0.9, &mut samples);
        place(start + period / 2, 0.9 * OFFBEAT_LEVEL, &mut samples);
    }
    samples
}

#[test]
fn the_slowest_tempo_in_range_is_detectable() {
    let result = estimate_bpm(&click_track(MIN_BPM), SAMPLE_RATE);

    let bpm = result.bpm.unwrap_or_else(|| {
        panic!(
            "a {MIN_BPM} BPM click track was reported as having no detectable tempo \
             (confidence {}); the peak scan excludes the lag `MIN_BPM` resolves to",
            result.confidence
        )
    });
    // A scan that cannot reach the true lag falls to the off-beat peak and
    // reports twice this, so the band only has to exclude the octave.
    assert!(
        (bpm - MIN_BPM).abs() < 2.0,
        "a {MIN_BPM} BPM click track was reported as {bpm:.2} BPM; the true lag sits on the \
         boundary of the peak scan"
    );
}

/// The boundary fix must not cost the interior of the range, where the scan
/// was already correct.
#[test]
fn a_mid_range_tempo_is_unchanged() {
    let result = estimate_bpm(&click_track(120.0), SAMPLE_RATE);

    let bpm = result
        .bpm
        .expect("a 120 BPM click track must have a detectable tempo");
    assert!(
        (bpm - 120.0).abs() < 2.0,
        "a 120 BPM click track was reported as {bpm:.2} BPM"
    );
}
