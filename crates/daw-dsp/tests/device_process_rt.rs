//! Allocation guards for every `#[wasm_bindgen]` render export in this crate.
//!
//! `crates/daw-dsp/AGENTS.md` states the RT contract as "allocation-free audio
//! path, proven by `assert_no_alloc` tests". Before this file that claim was
//! carried by three families (toaster, grinder, scoring) plus two `proof`
//! stages; bacteria, fermenter, gluten, grand_boule, knead and levain had a
//! guard on `set_param_by_id` or nothing at all, so an allocation added to
//! their render paths shipped silently. On `wasm32` an allocation that grows
//! linear memory calls `memory.grow()` on the audio thread.
//!
//! Each test here drives its engine into a *configured, audibly active* state
//! (asserted by a non-silence / signal-changed check outside the guard) and
//! then runs the real block loop inside `assert_no_alloc`. Driving the engine
//! matters: several engines early-return when every stage is at its default,
//! so a guard around an unconfigured instance would pass without executing the
//! DSP it claims to cover.
//!
//! The interceptor only exists in debug builds — `assert_no_alloc`'s
//! `disable_release` feature is on by default, so in release
//! `assert_no_alloc(f)` is literally `f()`. Everything here is therefore
//! `#[cfg(debug_assertions)]`, and `alloc_interceptor_aborts_...` below proves
//! the interceptor is installed rather than assumed.

#![cfg(debug_assertions)]

use assert_no_alloc::{assert_no_alloc, AllocDisabler};

#[global_allocator]
static ALLOCATOR: AllocDisabler = AllocDisabler;

const SAMPLE_RATE: f32 = 48_000.0;
const BLOCK: usize = 128;
const GUARDED_BLOCKS: usize = 32;

/// Deterministic non-trivial stereo excitation. Two partials plus a DC-free
/// transient so gates, compressors and detectors all see something to act on.
fn excitation(frame: usize) -> (f32, f32) {
    let t = frame as f32 / SAMPLE_RATE;
    let fundamental = (t * 220.0 * std::f32::consts::TAU).sin();
    let harmonic = (t * 1_760.0 * std::f32::consts::TAU).sin() * 0.35;
    let left = (fundamental + harmonic) * 0.5;
    let right = (fundamental - harmonic) * 0.5;
    (left, right)
}

/// Write `frames` of excitation through the raw input pointers an
/// AudioWorklet would write through. Pointer stores never allocate, so this is
/// safe to call from inside a guarded region and mirrors the real block loop.
///
/// # Safety
/// `left` and `right` must each point to at least `frames` writable `f32`s,
/// which is what every `get_input_*_ptr` on these instances returns.
unsafe fn fill_input(left: *mut f32, right: *mut f32, frames: usize, offset: usize) {
    for i in 0..frames {
        let (l, r) = excitation(offset + i);
        *left.add(i) = l;
        *right.add(i) = r;
    }
}

/// Read `frames` samples back out of a render export's returned pointer.
///
/// # Safety
/// `ptr` must point to at least `frames` readable `f32`s. Every export here
/// returns its own output buffer, sized at or above `frames`.
unsafe fn read_output(ptr: *const f32, frames: usize) -> Vec<f32> {
    assert!(!ptr.is_null(), "render export returned a null buffer");
    (0..frames).map(|i| *ptr.add(i)).collect()
}

fn peak(samples: &[f32]) -> f32 {
    samples.iter().fold(0.0_f32, |acc, s| acc.max(s.abs()))
}

fn assert_all_finite(samples: &[f32], what: &str) {
    for (i, s) in samples.iter().enumerate() {
        assert!(s.is_finite(), "{what} produced a non-finite sample at {i}: {s}");
    }
}

/// The whole file is worthless if the interceptor is not installed, so prove
/// it rather than trust it. A violation calls `std::alloc::handle_alloc_error`,
/// which aborts the process instead of unwinding, so `#[should_panic]` cannot
/// observe it — the check has to happen in a child process.
#[test]
fn alloc_interceptor_aborts_the_process_on_a_forbidden_allocation() {
    const CHILD_ENV: &str = "DAW_DSP_RT_CANARY_CHILD";
    const TEST_NAME: &str = "alloc_interceptor_aborts_the_process_on_a_forbidden_allocation";

    if std::env::var_os(CHILD_ENV).is_some() {
        // Allocate where allocation is forbidden. If the interceptor is live
        // this aborts and the parent observes a failing status; if it has been
        // stubbed out, this returns and the child exits 0, failing the parent.
        assert_no_alloc(|| {
            let leaked: Vec<f32> = Vec::with_capacity(1_024);
            std::hint::black_box(&leaked);
        });
        return;
    }

    let child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([TEST_NAME, "--exact", "--nocapture", "--test-threads=1"])
        .env(CHILD_ENV, "1")
        .output()
        .expect("failed to re-invoke the test binary as a child process");

    assert!(
        !child.status.success(),
        "the allocation interceptor is not live: a child process completed a \
         forbidden 1024-element allocation inside assert_no_alloc and exited \
         {:?}. Every other guard in this file is vacuous until this passes.",
        child.status.code(),
    );
}

#[test]
fn bacteria_process_does_not_allocate_with_codec_and_distortion_engaged() {
    use daw_dsp::bacteria::BacteriaInstance;

    let mut instance = BacteriaInstance::new(SAMPLE_RATE);
    // Multiband + distortion + the FHT codec path, which is the one stage in
    // this engine that runs a transform over a scratch frame every 256 samples.
    instance.set_param("bandCount", 3.0);
    instance.set_param("band0_distortionEnabled", 1.0);
    instance.set_param("band0_distortionDrive", 0.8);
    // `lofiEnabled` is the gate on the whole lo-fi stage. Without it the codec
    // transform never runs and this test would pass without executing the one
    // path in this engine it exists to cover.
    instance.set_param("lofiEnabled", 1.0);
    instance.set_param("lofiAmount", 60.0);
    instance.set_param("codecArtifact", 0.65);
    instance.set_param("mix", 1.0);

    unsafe {
        fill_input(
            instance.get_input_left_ptr(),
            instance.get_input_right_ptr(),
            BLOCK,
            0,
        );
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "bacteria");

    assert_no_alloc(|| {
        for block in 0..GUARDED_BLOCKS {
            unsafe {
                fill_input(
                    instance.get_input_left_ptr(),
                    instance.get_input_right_ptr(),
                    BLOCK,
                    block * BLOCK,
                );
            }
            instance.process(BLOCK as u32);
        }
    });

    // 32 blocks x 128 frames = 4096 samples, so the 256-sample codec frame
    // boundary was crossed 16 times per channel inside the guard above.
    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "bacteria");
    assert!(
        peak(&out) > 1e-4,
        "bacteria fell silent, so the guarded region did not exercise its DSP"
    );

    // Prove the codec stage was actually engaged rather than gated off. An
    // identically-driven instance with the codec disabled must produce a
    // different signal; if the two match, the guard above ran over a stage
    // that was never switched on and this test would pass for the wrong
    // reason — which is how the first draft of it passed.
    let mut without_codec = BacteriaInstance::new(SAMPLE_RATE);
    without_codec.set_param("bandCount", 3.0);
    without_codec.set_param("band0_distortionEnabled", 1.0);
    without_codec.set_param("band0_distortionDrive", 0.8);
    without_codec.set_param("lofiEnabled", 1.0);
    without_codec.set_param("lofiAmount", 60.0);
    without_codec.set_param("codecArtifact", 0.0);
    without_codec.set_param("mix", 1.0);
    let mut reference = Vec::new();
    for block in 0..=(GUARDED_BLOCKS + 1) {
        unsafe {
            fill_input(
                without_codec.get_input_left_ptr(),
                without_codec.get_input_right_ptr(),
                BLOCK,
                block * BLOCK,
            );
        }
        reference = unsafe { read_output(without_codec.process(BLOCK as u32), BLOCK) };
    }
    let divergence = out
        .iter()
        .zip(reference.iter())
        .fold(0.0_f32, |acc, (a, b)| acc.max((a - b).abs()));
    assert!(
        divergence > 1e-5,
        "bacteria output is identical with codecArtifact at 0.65 and at 0.0 \
         (max divergence {divergence:.3e}), so the codec stage never ran and \
         the allocation guard above covered nothing"
    );
}

#[test]
fn crumbs_process_does_not_allocate_with_a_sample_playing() {
    use daw_dsp::crumbs::CrumbsInstance;

    let mut instance = CrumbsInstance::new(SAMPLE_RATE);

    // An empty pool makes `note_on` return before allocating a voice, so the
    // guard has to run against a loaded, selected sample or it covers nothing.
    let frame_count = 4_800_usize;
    let pcm: Vec<f32> = (0..frame_count)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let sample_id = instance.add_sample(pcm, 1, SAMPLE_RATE as u32);
    instance.set_active_sample(sample_id);
    // Forward looping so the voice is still sounding at the end of the guarded
    // region rather than having run off the end of a 100 ms sample.
    instance.set_param("loopMode", 1.0);
    // Engage the filter as well: it is bypassed at the shipped 20 kHz default,
    // so leaving it there would exclude the SVF from the guarded path.
    instance.set_param("filterCutoff", 2_000.0);
    instance.set_param("filterResonance", 0.4);

    instance.note_on(60, 100);
    instance.note_on(67, 90);

    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "crumbs");

    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "crumbs");
    assert!(
        peak(&out) > 1e-6,
        "crumbs produced silence with two notes held, so the guarded region \
         did not exercise the sampler voice path"
    );
}

#[test]
fn fermenter_process_does_not_allocate_with_voices_sounding() {
    use daw_dsp::fermenter::FermenterInstance;

    let mut instance = FermenterInstance::new(SAMPLE_RATE, 8);
    instance.set_param("cutoff", 4_000.0);
    instance.set_param("resonance", 0.4);
    instance.set_param("unison_spread", 0.3);
    instance.set_param("noise_level", 0.1);
    for note in [48_u8, 55, 60, 64] {
        instance.note_on(note, 100);
    }

    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "fermenter");

    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "fermenter");
    assert!(
        peak(&out) > 1e-4,
        "fermenter produced silence with four voices held, so the guarded \
         region did not exercise the synth"
    );
}

#[test]
fn gluten_process_does_not_allocate_while_compressing() {
    use daw_dsp::gluten::GlutenInstance;

    let mut instance = GlutenInstance::new(SAMPLE_RATE);
    instance.set_param("threshold", -24.0);
    instance.set_param("ratio", 8.0);
    instance.set_param("attack", 5.0);
    instance.set_param("release", 100.0);
    instance.set_param("makeup", 3.0);

    unsafe {
        fill_input(
            instance.get_input_left_ptr(),
            instance.get_input_right_ptr(),
            BLOCK,
            0,
        );
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "gluten");

    assert_no_alloc(|| {
        for block in 0..GUARDED_BLOCKS {
            unsafe {
                fill_input(
                    instance.get_input_left_ptr(),
                    instance.get_input_right_ptr(),
                    BLOCK,
                    block * BLOCK,
                );
            }
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "gluten");
    assert!(
        peak(&out) > 1e-4,
        "gluten fell silent, so the guarded region did not exercise the compressor"
    );
}

#[test]
fn grand_boule_process_does_not_allocate_with_notes_held() {
    use daw_dsp::grand_boule::GrandBouleInstance;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 0);
    instance.note_on(48, 0.9);
    instance.note_on(60, 0.7);
    instance.note_on(67, 0.5);

    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "grand_boule");

    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "grand_boule");
    assert!(
        peak(&out) > 1e-6,
        "grand_boule produced silence with three notes held, so the guarded \
         region did not exercise the modal model"
    );
}

#[test]
fn grinder_process_and_automated_process_do_not_allocate() {
    use daw_dsp::grinder::GrinderInstance;

    let mut instance = GrinderInstance::new(SAMPLE_RATE);
    instance.set_param("ampModel", 2.0);
    instance.set_param("gain", 0.75);
    instance.set_param("bass", 0.6);
    instance.set_param("mid", 0.4);
    instance.set_param("treble", 0.7);
    instance.set_param("masterVolume", 0.8);

    unsafe {
        fill_input(
            instance.get_input_left_ptr(),
            instance.get_input_right_ptr(),
            BLOCK,
            0,
        );
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "grinder");

    assert_no_alloc(|| {
        for block in 0..GUARDED_BLOCKS {
            unsafe {
                fill_input(
                    instance.get_input_left_ptr(),
                    instance.get_input_right_ptr(),
                    BLOCK,
                    block * BLOCK,
                );
            }
            instance.process(BLOCK as u32);
            instance.process_automated(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "grinder");
    assert!(
        peak(&out) > 1e-4,
        "grinder fell silent, so the guarded region did not exercise the amp"
    );
}

#[test]
fn knead_process_does_not_allocate_while_shifting_pitch() {
    use daw_dsp::knead::KneadInstance;

    let mut instance = KneadInstance::new(SAMPLE_RATE);
    // PSOLA is a passthrough at 0 semitones; engage it so the guard covers the
    // analysis/overlap-add path rather than a copy.
    instance.set_shift_semitones(4.0);

    // PSOLA needs a full analysis frame (2048) buffered before it emits shifted
    // audio, so warm past that outside the guard.
    for block in 0..24 {
        unsafe {
            fill_input(
                instance.get_input_left_ptr(),
                instance.get_input_right_ptr(),
                BLOCK,
                block * BLOCK,
            );
        }
        let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
        assert_all_finite(&out, "knead");
    }

    assert_no_alloc(|| {
        for block in 24..(24 + GUARDED_BLOCKS) {
            unsafe {
                fill_input(
                    instance.get_input_left_ptr(),
                    instance.get_input_right_ptr(),
                    BLOCK,
                    block * BLOCK,
                );
            }
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "knead");
    assert!(
        peak(&out) > 1e-4,
        "knead fell silent, so the guarded region did not exercise PSOLA"
    );
}

#[test]
fn levain_process_does_not_allocate_with_notes_held() {
    use daw_dsp::levain::LevainInstance;

    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);

    // Load one real looping sample and map it across the keyboard. Without a
    // zone map `note_on` falls through to the fallback sine, which is a
    // different (and much smaller) code path than the sampler voice this guard
    // is for — and that fallback is `enabled: false` on a fresh engine anyway,
    // so an unconfigured instance renders silence.
    let frame_count = 4_800_u32;
    let sample: Vec<f32> = (0..frame_count)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let sample_id = instance.add_sample(sample, frame_count, 1, SAMPLE_RATE);
    instance.add_zone(
        0,          // zone_id
        sample_id,  // sample_id
        0,          // articulation_id
        69,         // root_note
        0,          // lo_key
        127,        // hi_key
        0,          // lo_vel
        127,        // hi_vel
        0,          // rr_pos
        1,          // rr_len
        0,          // mic_id
        false,      // is_release
        1,          // loop_mode: forward, so the voice never runs out of sample
        0,          // loop_start
        frame_count, // loop_end
        0,          // loop_crossfade
        0.0,        // gain_db
        0.005,      // attack
        0.1,        // decay
        1.0,        // sustain
        0.3,        // release
    );
    instance.build_zone_map(1, 1);

    instance.note_on(60, 100);
    instance.note_on(64, 90);

    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "levain");

    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "levain");
    assert!(
        peak(&out) > 1e-6,
        "levain produced silence with two notes held, so the guarded region \
         did not exercise the sampler voice path"
    );
}

#[test]
fn proof_process_does_not_allocate_across_the_full_mastering_chain() {
    use daw_dsp::proof::ProofInstance;

    let mut instance = ProofInstance::new(SAMPLE_RATE);
    instance.set_param("eq_linear_phase", 1.0);
    instance.set_param("limiter_ceiling", -1.0);
    instance.set_param("limiter_threshold", -12.0);

    unsafe {
        fill_input(
            instance.get_input_left_ptr(),
            instance.get_input_right_ptr(),
            BLOCK,
            0,
        );
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "proof");

    assert_no_alloc(|| {
        for block in 0..GUARDED_BLOCKS {
            unsafe {
                fill_input(
                    instance.get_input_left_ptr(),
                    instance.get_input_right_ptr(),
                    BLOCK,
                    block * BLOCK,
                );
            }
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "proof");
    assert!(
        peak(&out) > 1e-4,
        "proof fell silent, so the guarded region did not exercise the chain"
    );
}

#[test]
fn toaster_process_does_not_allocate_with_pads_triggered() {
    use daw_dsp::toaster::ToasterInstance;

    let mut instance = ToasterInstance::new(SAMPLE_RATE, 8);
    instance.note_on(0, 1.0, 36);
    instance.note_on(1, 0.8, 38);

    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "toaster");

    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "toaster");
    assert!(
        peak(&out) > 1e-4,
        "toaster produced silence with two pads triggered, so the guarded \
         region did not exercise the pad voices"
    );
}
