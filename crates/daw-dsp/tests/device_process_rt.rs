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
        assert!(
            s.is_finite(),
            "{what} produced a non-finite sample at {i}: {s}"
        );
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
    //
    // The measured block is refilled, and the reference below runs to the same
    // block index. Without that the two render *different* blocks of
    // excitation and diverge whatever the codec setting is, which left the
    // engagement assertion at the bottom of this test unable to fail.
    const MEASURE_BLOCK: usize = GUARDED_BLOCKS;
    unsafe {
        fill_input(
            instance.get_input_left_ptr(),
            instance.get_input_right_ptr(),
            BLOCK,
            MEASURE_BLOCK * BLOCK,
        );
    }
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
    for block in 0..=MEASURE_BLOCK {
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
fn bacteria_granular_process_does_not_allocate_with_grains_sounding() {
    use daw_dsp::bacteria::BacteriaInstance;

    let mut instance = BacteriaInstance::new(SAMPLE_RATE);
    instance.set_param("bandCount", 1.0);
    instance.set_param("band0_granularEnabled", 1.0);
    instance.set_param("band0_grainSize", 80.0);
    instance.set_param("band0_grainDensity", 100.0);
    instance.set_param("band0_grainPosOffset", 0.0);
    instance.set_param("band0_grainPitch", 0.0);
    instance.set_param("band0_grainMix", 1.0);
    instance.set_param("mix", 1.0);

    for block in 0..8 {
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

    assert_no_alloc(|| {
        for block in 8..8 + GUARDED_BLOCKS {
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

    let output = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&output, "bacteria granular");
    assert!(
        peak(&output) > 1e-4,
        "Bacteria granular output was silent, so the allocation guard covered no sounding grain"
    );
}

/// The Smudge distortion mode is the second transform in this engine that runs
/// over a scratch frame — a 2048-point overlap-add STFT per channel, firing
/// every 512 samples — and it is not reached by the test above, which leaves
/// `distortionMode` on its `soft-clip` default. Its buffers are sized in
/// `SmudgeProcessor::new`; anything that made the render path resize one would
/// call `memory.grow()` on the audio thread.
#[test]
fn bacteria_smudge_mode_does_not_allocate() {
    use daw_dsp::bacteria::BacteriaInstance;

    /// Enough guarded blocks to cross the 512-sample hop several times per
    /// channel: 48 x 128 = 6144 samples, so 12 frames.
    const SMUDGE_BLOCKS: usize = 48;

    let mut instance = BacteriaInstance::new(SAMPLE_RATE);
    instance.set_param("bandCount", 1.0);
    instance.set_param("band0_distortionEnabled", 1.0);
    instance.set_param("band0_distortionMode", 7.0); // smudge
    instance.set_param("band0_drive", 40.0);
    instance.set_param("mix", 1.0);

    // Warm the overlap-add path past its `ready` gate before the guard, so the
    // guarded region runs the transform rather than the dry passthrough.
    for block in 0..8 {
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

    assert_no_alloc(|| {
        for block in 8..(8 + SMUDGE_BLOCKS) {
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

    // The measured block is refilled like every other one. Leaving the stale
    // input in place would compare this block against a *different* block of
    // the reference below, and the two would then diverge whatever mode ran —
    // which is how the first draft of this test passed with smudge removed.
    const MEASURE_BLOCK: usize = 8 + SMUDGE_BLOCKS;
    unsafe {
        fill_input(
            instance.get_input_left_ptr(),
            instance.get_input_right_ptr(),
            BLOCK,
            MEASURE_BLOCK * BLOCK,
        );
    }
    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "bacteria smudge");
    assert!(
        peak(&out) > 1e-4,
        "bacteria fell silent under smudge, so the guarded region did not \
         exercise its DSP"
    );

    // Prove the guarded region ran *smudge* and not the soft-clip fallback the
    // mode used to land on. An identically-driven instance left on soft-clip
    // must produce a different signal.
    let mut soft_clip = BacteriaInstance::new(SAMPLE_RATE);
    soft_clip.set_param("bandCount", 1.0);
    soft_clip.set_param("band0_distortionEnabled", 1.0);
    soft_clip.set_param("band0_distortionMode", 0.0);
    soft_clip.set_param("band0_drive", 40.0);
    soft_clip.set_param("mix", 1.0);
    let mut reference = Vec::new();
    for block in 0..=MEASURE_BLOCK {
        unsafe {
            fill_input(
                soft_clip.get_input_left_ptr(),
                soft_clip.get_input_right_ptr(),
                BLOCK,
                block * BLOCK,
            );
        }
        reference = unsafe { read_output(soft_clip.process(BLOCK as u32), BLOCK) };
    }
    let divergence = out
        .iter()
        .zip(reference.iter())
        .fold(0.0_f32, |acc, (a, b)| acc.max((a - b).abs()));
    assert!(
        divergence > 1e-5,
        "bacteria renders identically on distortionMode 7 and 0 (max \
         divergence {divergence:.3e}), so the smudge transform never ran and \
         the allocation guard above covered nothing"
    );
}

/// `note_on` is not a render export, but it runs on the audio thread: the
/// native host drains its command ring inside the process callback, and the
/// worklet dispatches port messages on the render thread. Since a note now
/// routes through `crumbs::modes` to build its trigger params, an allocation
/// added to any of the three mapping functions would land there — a `Vec` for
/// a marker search, a clone of a `PadConfig` — and `process` guards would not
/// see it.
#[test]
fn crumbs_note_on_does_not_allocate_in_any_mode() {
    use std::sync::Arc;

    use daw_dsp::crumbs::engine::CrumbsEngine;
    use daw_dsp::crumbs::sample::SampleData;
    use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsMode};

    let frames = 4_800_usize;
    let pcm: Vec<f32> = (0..frames)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();

    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    // Pooling is the only setup: pads are left unassigned and no markers are
    // set, so the guard covers the *default* kit and the computed default chop
    // — the paths a freshly loaded sample actually takes. A choke group on pad
    // 0 puts the choke pass inside the guard too; it is a field write, unlike
    // `set_pad_sample`/`set_markers_from_onsets`, which allocate and belong to
    // setup.
    let sample_id = engine.add_sample(Arc::new(SampleData::from_mono(pcm, SAMPLE_RATE as u32)));
    engine.set_active_sample(sample_id);
    engine.drum_mode_mut().set_pad_choke_group(0, 1);

    // Each mode must actually reach a voice, or the guard covers three
    // early returns. Checked before the guarded region so the assertions
    // themselves cannot allocate inside it.
    for (mode, note) in [
        (CrumbsMode::Quick, 60_u8),
        (CrumbsMode::Drum, 36),
        (CrumbsMode::Slice, 37),
    ] {
        let mut probe = CrumbsEngine::new(SAMPLE_RATE);
        let probe_id = probe.add_sample(Arc::new(SampleData::from_mono(
            vec![0.5_f32; frames],
            SAMPLE_RATE as u32,
        )));
        probe.set_active_sample(probe_id);
        probe.handle_command(CrumbsCommand::SetMode(mode));
        probe.handle_command(CrumbsCommand::NoteOn {
            note,
            velocity: 100,
        });
        let mut left = vec![0.0_f32; BLOCK];
        let mut right = vec![0.0_f32; BLOCK];
        probe.process_block(&mut left, &mut right);
        assert!(
            peak(&left) > 1e-6,
            "{mode:?} produced silence for note {note}, so the guarded region \
             below would cover a note that never triggered a voice"
        );
    }

    assert_no_alloc(|| {
        // More notes than the 128-voice pool holds, so voice stealing and the
        // choke pass are inside the guard as well as the mapping.
        // `SetActiveSample` is in the loop because selecting a sample now
        // looks the frame count up in the pool and feeds both mode defaults.
        for round in 0..200_u8 {
            engine.handle_command(CrumbsCommand::SetActiveSample(sample_id));
            engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Quick));
            engine.handle_command(CrumbsCommand::NoteOn {
                note: 48 + (round % 24),
                velocity: 100,
            });
            engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Drum));
            engine.handle_command(CrumbsCommand::NoteOn {
                note: 36,
                velocity: 100,
            });
            engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Slice));
            engine.handle_command(CrumbsCommand::NoteOn {
                note: 37,
                velocity: 100,
            });
        }
    });

    // The guarded loop must have left voices sounding. Without this, a
    // `note_on` that returned early in every mode would be trivially
    // allocation-free and the guard would cover nothing.
    let mut left = vec![0.0_f32; BLOCK];
    let mut right = vec![0.0_f32; BLOCK];
    engine.process_block(&mut left, &mut right);
    assert!(
        peak(&left) > 1e-6,
        "the guarded note_on loop left no voice sounding, so it never reached \
         the voice path it claims to guard"
    );
}

/// `CrumbsCommand::AddSample` is drained inside the process callback — the
/// native host pops its command ring there, and the worklet dispatches port
/// messages on the render thread — so filing a sample in the pool is an
/// audio-thread operation whatever its name suggests.
///
/// It used to grow the pool's slot vector with a push loop, which allocates
/// (audit F4). Nothing else guards it: every other crumbs test in this file
/// pools its samples *before* arming the interceptor, which is exactly the
/// shape that let the allocation live in a "management thread" path that the
/// audio thread reaches on every sample load.
///
/// The `Arc`s and their PCM are built outside the guard, because that half is
/// genuinely the sender's work: the command carries a pointer, and the audio
/// thread only files it. Ids are fresh, as the command side's monotonic
/// counter guarantees, so no slot is overwritten and nothing is dropped inside
/// the guarded region either.
#[test]
fn crumbs_add_sample_command_does_not_allocate() {
    use std::sync::Arc;

    use daw_dsp::crumbs::engine::CrumbsEngine;
    use daw_dsp::crumbs::sample::SampleData;
    use daw_dsp::crumbs::types::{CrumbsCommand, CrumbsMode};

    const STAGED: usize = 8;

    let frames = 4_800_usize;
    let pcm: Vec<f32> = (0..frames)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();

    let mut engine = CrumbsEngine::new(SAMPLE_RATE);
    engine.handle_command(CrumbsCommand::SetMode(CrumbsMode::Quick));

    let staged: Vec<Arc<SampleData>> = (0..STAGED)
        .map(|_| Arc::new(SampleData::from_mono(pcm.clone(), SAMPLE_RATE as u32)))
        .collect();
    let mut left = vec![0.0_f32; BLOCK];
    let mut right = vec![0.0_f32; BLOCK];

    assert_no_alloc(|| {
        for (id, sample) in staged.iter().enumerate() {
            engine.handle_command(CrumbsCommand::AddSample {
                id: id as u32,
                data: Arc::clone(sample),
            });
            engine.handle_command(CrumbsCommand::SetActiveSample(id as u32));
            engine.handle_command(CrumbsCommand::NoteOn {
                note: 60,
                velocity: 100,
            });
            engine.process_block(&mut left, &mut right);
        }
    });

    // The guarded loop must have actually filed the samples and played them,
    // or a `set` that silently dropped every write would be trivially
    // allocation-free.
    assert_eq!(
        engine.sample_pool().count(),
        STAGED,
        "the guarded AddSample commands did not reach the pool, so the guard covered a no-op"
    );
    assert!(
        peak(&left) > 1e-6,
        "the guarded region rendered silence, so the samples it filed never reached a voice"
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
    //
    // `filterResonance` reads Q, so this was written as `0.4` back when the
    // setter clamped a Q reading into 0–1: 8.3 is the Q that 0.4 resolved to
    // (`0.5 + 0.4 × 19.5`), i.e. the same filter state this guard has always
    // run against, restated in the parameter's real units. In Q it would have
    // been below the knob's 0.5 floor and pinned to the least resonant setting.
    instance.set_param("filterCutoff", 2_000.0);
    instance.set_param("filterResonance", 8.3);

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

/// The voice-stealing path, held open deliberately.
///
/// Neither existing crumbs guard reaches it, which was checked rather than
/// assumed — a `Vec::with_capacity` planted in the tail render branch left both
/// of them passing:
///
/// - `crumbs_process_does_not_allocate_with_a_sample_playing` holds two notes
///   against a 128-slot pool, so nothing is ever stolen and no fade is ever
///   rendered;
/// - `crumbs_note_on_does_not_allocate_in_any_mode` does saturate the pool and
///   does cover the swap into a fade slot, but every one of its
///   `process_block` calls is *outside* the guarded region, so the rendering
///   half of the steal path is not in it.
///
/// This one saturates the pool by construction and asserts it *is* saturated
/// before the interceptor arms, so it cannot go blind if the note mapping or
/// the envelope defaults change. It then steals and renders inside the same
/// guarded region, and the closing burst starts more fades than there are slots
/// within one 3 ms fade so the slot-recycling branch is covered too.
#[test]
fn crumbs_voice_stealing_does_not_allocate() {
    use daw_dsp::crumbs::CrumbsInstance;

    let mut instance = CrumbsInstance::new(SAMPLE_RATE);

    let frame_count = 4_800_usize;
    let pcm: Vec<f32> = (0..frame_count)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let sample_id = instance.add_sample(pcm, 1, SAMPLE_RATE as u32);
    instance.set_active_sample(sample_id);
    // Forward looping so no voice runs off the end of a 100 ms sample and
    // quietly frees the slot the next note would otherwise steal.
    instance.set_param("loopMode", 1.0);
    // Long release so a stolen note's replacement stays in the pool: a voice
    // that retired between rounds would be a fill, not a steal.
    instance.set_param("release", 2.0);
    // Everything a steal touches, driven *off* its default.
    //
    // A steal hands the incoming note a voice that came fresh out of the pool
    // and `trigger` reconfigures it, so anything that sizes per-voice storage
    // from a parameter would allocate right there — and only at a value where
    // the setter has real work to do. Fermenter shipped exactly that trap: its
    // unison oscillator grew a buffer in `set_voices`, and the guard missed it
    // because it ran at the default unison of 1, where the early return fires.
    //
    // Crumbs has no such parameter today — `CrumbsVoice` owns no heap storage
    // at all, which `crumbs::engine`'s `needs_drop` assertion enforces at
    // compile time — so this is defence in depth rather than the load-bearing
    // check. It still costs nothing to steal with the filter engaged, the
    // envelope shaped and eight stacked voices per note-on instead of one.
    //
    // `filterResonance` is in Q; 8.3 is the Q the previous literal `0.4`
    // resolved to under the old clamp-as-normalised setter, so the guarded
    // filter state is unchanged.
    instance.set_param("filterCutoff", 2_000.0);
    instance.set_param("filterResonance", 8.3);
    instance.set_param("attack", 0.05);
    instance.set_param("hold", 0.02);
    instance.set_param("decay", 0.3);
    instance.set_param("sustain", 0.6);
    instance.set_param("loopCrossfade", 512.0);
    instance.set_param("stackCount", 8.0);
    instance.set_param("detuneSpread", 25.0);
    instance.set_param("stackSpread", 0.8);

    // Saturate the 128-slot pool outside the guard, so every guarded note-on is
    // a steal rather than a fill. Sixteen notes at a stack of eight fill it
    // exactly: one more note-on here would steal *before* the interceptor arms
    // and leave fades outstanding, which the occupancy assertion below would
    // then read as an over-full pool.
    for step in 0..16_u8 {
        instance.note_on(step * 7, 100);
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "crumbs steal");
    assert_eq!(
        instance.active_voices(),
        128,
        "the pool is not full, so the guarded blocks would allocate free slots \
         instead of stealing"
    );

    let mut note = 0_u8;
    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            for _ in 0..8 {
                instance.note_on(note, 100);
                note = note.wrapping_add(7);
            }
            instance.process(BLOCK as u32);
        }
        // 200 steals with nothing rendered in between: all 128 fade slots are
        // in flight before the first of them has decayed, which is the only way
        // to reach the recycle branch.
        for _ in 0..200 {
            instance.note_on(note, 100);
            note = note.wrapping_add(7);
        }
        instance.process(BLOCK as u32);
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "crumbs steal");
    assert!(
        peak(&out) > 1e-6,
        "crumbs produced silence under sustained stealing, so the guarded \
         region did not exercise the steal path"
    );
}

#[test]
fn crumbs_resampling_budget_bounds_max_pitch_process_without_allocating() {
    use daw_dsp::crumbs::CrumbsInstance;

    let mut instance = CrumbsInstance::new(SAMPLE_RATE);
    let frame_count = 4_800_usize;
    let pcm: Vec<f32> = (0..frame_count)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let sample_id = instance.add_sample(pcm, 1, SAMPLE_RATE as u32);
    instance.set_active_sample(sample_id);
    instance.set_param("loopMode", 1.0);
    instance.set_param("loopEnd", frame_count as f32);
    instance.set_param("stackCount", 8.0);
    instance.set_param("tune", 24.0);

    for _ in 0..16 {
        instance.note_on(127, 100);
    }
    instance.process(BLOCK as u32);
    assert_eq!(instance.active_voices(), 24);

    instance.all_sound_off();
    for _ in 0..16 {
        instance.note_on(127, 100);
    }

    let mut output_ptr = std::ptr::null();
    assert_no_alloc(|| {
        output_ptr = instance.process(BLOCK as u32);
    });
    let output = unsafe { read_output(output_ptr, BLOCK) };
    assert_all_finite(&output, "crumbs max-pitch full pool");
    assert_eq!(instance.active_voices(), 24);
    assert!(peak(&output) > 1.0e-6);
}

/// Crust drives more stages per sample than any other effect here — five band
/// limiters, an oversampled saturator, the LR-4 splitter, dither and the full
/// EBU R 128 meter set — and each of them owns a buffer sized at construction.
/// The band count, the oversampling factor and the look-ahead are all runtime
/// switches, so this drives the *widest* configuration: anything that sized a
/// buffer from a parameter rather than from its maximum would grow it here.
#[test]
fn crust_process_does_not_allocate_while_limiting() {
    use daw_dsp::crust::CrustInstance;

    let mut instance = CrustInstance::new(SAMPLE_RATE);
    instance.set_param("gain", 12.0);
    instance.set_param("ceiling", -1.0);
    instance.set_param("lookahead", 5.0);
    instance.set_param("true_peak", 1.0);
    instance.set_param("multi_band", 2.0); // 5 bands
    instance.set_param("stereo_mode", 1.0); // mid/side
    instance.set_param("sat_enabled", 1.0);
    instance.set_param("sat_algorithm", 2.0);
    instance.set_param("sat_drive", 9.0);
    instance.set_param("sat_mix", 60.0);
    instance.set_param("oversampling", 32.0);
    instance.set_param("sc_hpf_enabled", 1.0);
    instance.set_param("dither", 3.0); // noise-shaped
    instance.set_param("output_bit_depth", 16.0);

    unsafe {
        fill_input(
            instance.get_input_left_ptr(),
            instance.get_input_right_ptr(),
            BLOCK,
            0,
        );
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "crust");

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
    assert_all_finite(&out, "crust");
    assert!(
        peak(&out) > 1e-4,
        "crust fell silent, so the guarded region did not exercise the limiter"
    );
    assert!(
        instance.get_gr_db() < -0.5,
        "crust applied {:.2} dB of gain reduction, so the guarded region ran a \
         limiter that was never limiting",
        instance.get_gr_db()
    );
}

#[test]
fn fermenter_process_does_not_allocate_with_voices_sounding() {
    use daw_dsp::fermenter::FermenterInstance;

    let mut instance = FermenterInstance::new(SAMPLE_RATE, 8);
    instance.set_param("filter_model", 4.0);
    instance.set_param("cutoff", 1_500.0);
    instance.set_param("resonance", 4.0);
    instance.set_param("filter_drive", 2.0);
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
fn fermenter_karplus_glide_does_not_allocate_while_sounding() {
    use daw_dsp::fermenter::FermenterInstance;

    let mut instance = FermenterInstance::new(SAMPLE_RATE, 8);
    instance.set_param("engine", 3.0);
    instance.set_param("ks_brightness", 0.8);
    instance.set_param("ks_damping", 0.5);
    instance.set_param("portamento_mode", 0.0);
    instance.set_param("portamento", 0.0);
    instance.note_on(48, 127);
    instance.process(BLOCK as u32);
    instance.note_off(48);
    for _ in 0..64 {
        instance.process(BLOCK as u32);
    }
    instance.set_param("portamento", 2.0);
    instance.note_on(72, 127);

    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "fermenter Karplus glide");
    assert!(
        peak(&out) > 1e-4,
        "Karplus glide fell silent, so the guarded region did not exercise the moving delay"
    );
}

/// The scheduled-note path: events are drained into a per-block list and the
/// render splits at each offset. Draining into a list is exactly where a `Vec`
/// creeps back in, so the guard covers the pushes *and* the split render — the
/// block above only covers `process` with an empty list.
#[test]
fn fermenter_scheduled_note_offsets_do_not_allocate() {
    use daw_dsp::fermenter::FermenterInstance;

    let mut instance = FermenterInstance::new(SAMPLE_RATE, 8);
    instance.set_param("cutoff", 4_000.0);
    instance.set_param("resonance", 0.4);
    instance.set_param("noise_level", 0.1);
    instance.set_param("layer_level", 0.75);
    instance.set_param("layer_pan", 0.4);

    // Warm up outside the guard so wavetable/voice-pool lazy work, if any,
    // happens before the interceptor is armed.
    instance.push_note_on(60, 100, 0, 37);
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "fermenter scheduled");

    assert_no_alloc(|| {
        for block in 0..GUARDED_BLOCKS {
            let note = 48 + (block % 12) as u8;
            for offset in 0..BLOCK {
                if offset == 0 {
                    assert!(instance.push_note_off(note, 0));
                    assert!(instance.push_note_on(note, 100, 0, 0));
                } else {
                    assert!(instance.push_note_expression(note, 0, 1.5, 0.5, 0.25, offset as u32));
                    assert!(instance.push_note_off(1, offset as u32));
                }
            }
            assert!(!instance.push_note_on(60, 1, 0, (BLOCK - 1) as u32));

            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "fermenter scheduled");
    assert!(
        peak(&out) > 1e-4,
        "fermenter produced silence under scheduled notes, so the guarded \
         region did not exercise the split render"
    );
}

/// The voice-stealing path, held open deliberately.
///
/// `fermenter_process_does_not_allocate_with_voices_sounding` never reaches it:
/// `FermenterInstance::note_on` applies immediately, so its four notes are
/// allocated on the caller's thread before the interceptor is armed. The
/// worklet does not work that way — it queues note-ons and `process` applies
/// them, so the pool saturates and steals *inside* the render callback, where a
/// steal swaps the displaced voice into a preallocated crossfade slot.
///
/// `fermenter_scheduled_note_offsets_do_not_allocate` does reach it, but only
/// by accident: its release tails pile up under the default release time until
/// the pool happens to fill. Shorten that release, or change which notes it
/// cycles, and the steal path silently stops being covered while the test keeps
/// passing. This one saturates the pool by construction and asserts it *is*
/// saturated before the interceptor arms, so it cannot go blind the same way.
/// Eight steals per block also exhausts all 16 crossfade slots well inside the
/// first 10 ms fade, covering the slot-recycling branch.
///
/// Unison is set above 1 deliberately, and it is the whole point of the guard
/// rather than incidental configuration. A steal hands the incoming note a
/// `Voice` taken from `steal_tails`, which `Voice::new` built with a
/// single-element unison `Vec`; `note_on` then calls `set_unison(count, ..)` on
/// it, and `UnisonOsc::set_voices` grows that `Vec`. At the default unison of 1
/// the early return fires and nothing happens, so a guard left at the default
/// exercises the steal path and still reports clean while `process` allocates
/// for every user who ever turned unison up.
#[test]
fn fermenter_voice_stealing_does_not_allocate() {
    use daw_dsp::fermenter::FermenterInstance;

    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    instance.set_param("cutoff", 4_000.0);
    instance.set_param("resonance", 0.4);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 2.0);
    instance.set_param("unison_voices", 8.0);
    // Glide armed, so the guarded note-ons take the portamento branch. Left at
    // the default 0 this test never entered it, and the glide path — which
    // reads the synth-level last-played pitch and seeds each stolen voice from
    // it — had never been under the allocation interceptor at all.
    instance.set_param("portamento", 3.0);

    // Saturate the 16-slot pool outside the guard, so every guarded note-on is
    // a steal rather than a fill.
    for note in 36_u8..52 {
        instance.note_on(note, 100);
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "fermenter steal");
    assert_eq!(
        instance.active_voices(),
        16,
        "the pool is not full, so the guarded blocks would allocate free slots \
         instead of stealing"
    );

    let mut note = 52_u8;
    assert_no_alloc(|| {
        for _ in 0..GUARDED_BLOCKS {
            for slot in 0..8_u32 {
                assert!(instance.push_note_on(note, 100, 0, slot * 16));
                note = if note >= 96 { 52 } else { note + 1 };
            }
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "fermenter steal");
    assert!(
        peak(&out) > 1e-4,
        "fermenter produced silence under sustained stealing, so the guarded \
         region did not exercise the steal path"
    );
}

/// Raising the unison count while voices sound, which allocated before the
/// crossfade-slot work and does not now.
///
/// This is not the steal regression above — it fails on `main` too. Automating
/// or sweeping `unison_voices` reaches `UnisonOsc::set_voices` for every
/// sounding voice, and a `Vec` sized for the count it happens to hold has to
/// grow every time the knob goes up. Reserving the full `clamp(1, 16)` range at
/// construction closes both paths, so the pre-existing one is pinned here
/// rather than left to be rediscovered.
#[test]
fn fermenter_unison_sweep_does_not_allocate() {
    use daw_dsp::fermenter::FermenterInstance;

    let mut instance = FermenterInstance::new(SAMPLE_RATE, 16);
    instance.set_param("amp_sustain", 1.0);
    instance.set_param("amp_release", 2.0);
    instance.set_param("unison_voices", 1.0);

    for note in 48_u8..56 {
        instance.note_on(note, 100);
    }
    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "fermenter unison sweep");

    assert_no_alloc(|| {
        for block in 0..GUARDED_BLOCKS {
            // Walk the whole accepted range, up and back down, so both the
            // growing and the already-large cases are covered.
            let count = 1 + (block % 16);
            instance.set_param("unison_voices", count as f32);
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "fermenter unison sweep");
    assert!(
        peak(&out) > 1e-4,
        "fermenter produced silence under a unison sweep, so the guarded region \
         did not exercise the resize path"
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
    instance.set_param("sc_hpf_enabled", 1.0);
    instance.set_param("sc_lpf_enabled", 1.0);
    instance.set_param("sc_eq_enabled", 1.0);
    instance.set_param("sc_eq_gain", 6.0);
    instance.set_param("thrust", 2.0);

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

/// Driven at a **non-default** stereo link on purpose, and across every
/// topology.
///
/// `stereo_link` defaults to 1, and at 1 the detector hands both channels the
/// same level and each topology takes a fast route that runs *one* gain path
/// and copies it — so the guard above, which sits at the default, never
/// executes the second channel's ballistics at all. The branch that only runs
/// below link 1 is the newer code and the one with two envelopes to keep, so
/// it is the branch that needs the allocation claim.
#[test]
fn gluten_process_does_not_allocate_with_an_unlinked_detector() {
    use daw_dsp::gluten::GlutenInstance;

    for topology in 0..4_u32 {
        let mut instance = GlutenInstance::new(SAMPLE_RATE);
        instance.set_param("topology", topology as f32);
        instance.set_param("threshold", -24.0);
        instance.set_param("ratio", 8.0);
        instance.set_param("attack", 5.0);
        instance.set_param("release", 100.0);
        instance.set_param("makeup", 3.0);
        // The two settings this guard exists for: an unlinked detector runs
        // both gain paths, and RMS detection runs both integrators.
        instance.set_param("stereo_link", 0.35);
        instance.set_param("detection", 0.0);

        unsafe {
            fill_input(
                instance.get_input_left_ptr(),
                instance.get_input_right_ptr(),
                BLOCK,
                0,
            );
        }
        let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
        assert_all_finite(&warmup, "gluten unlinked");

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
        assert_all_finite(&out, "gluten unlinked");
        assert!(
            peak(&out) > 1e-4,
            "gluten topology {topology} fell silent, so the guarded region did not \
             exercise the unlinked detector"
        );
    }
}

/// Driven at **non-default** calibration on purpose.
///
/// `cc_smoothing_ms` defaults to 0, and at 0 `advance_sustain_smoothing`
/// early-returns before it computes anything — the coefficient path this
/// guard exists to cover never runs, and neither does the damper retune it
/// feeds. Three GrandBoule guards in this file used to sit at that default,
/// which is the same shape as the voice-stealing guard that ran at unison 1
/// and the other default-blind guards this crate has collected: the assertion
/// is green because the code under it never executed.
///
/// So: a real smoothing constant, a calibrated lift point, one key released
/// under a moving pedal (a held key short-circuits `damper_bandwidth_for_key`
/// to 0 Hz and nothing downstream runs), and the pedal moved just before the
/// guard arms so the smoother is mid-travel across every guarded block and
/// `PianoVoice::set_extra_damping` keeps calling `reset_decay` inside it.
#[test]
fn grand_boule_process_does_not_allocate_with_notes_held() {
    use daw_dsp::grand_boule::GrandBouleInstance;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 0);
    instance.set_param("cc_smoothing_ms", 25.0);
    instance.set_param("sustain_threshold", 0.3);
    // Keep the new radiation smoother and non-default room response active in
    // the guarded region; a default Player/open setting is an identity path.
    instance.set_param("lid_position", 0.35);
    instance.set_param("mic_position", 2.0);
    instance.set_sustain(0.9);
    instance.note_on(48, 0.9);
    instance.note_on(60, 0.7);
    instance.note_on(67, 0.5);
    // Released under the pedal: pedal-sustained, so it keeps sounding and the
    // damper curve governs it rather than the held-key short circuit.
    instance.note_off(48);

    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "grand_boule");

    // Pedal set moving right before the guard: the smoother spends the whole
    // guarded region converging, so the per-block coefficient and the damper
    // retune both run inside `assert_no_alloc` rather than settling first.
    instance.set_sustain(0.35);

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
fn grand_boule_voice_steal_crossfade_does_not_allocate() {
    use daw_dsp::grand_boule::GrandBouleInstance;

    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, 3);
    for note in [60, 64, 67] {
        instance.note_on(note, 0.8);
    }
    instance.process(BLOCK as u32);

    assert_no_alloc(|| {
        instance.note_on(65, 0.8);
        instance.process(BLOCK as u32);
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "grand_boule voice steal");
    assert!(
        peak(&out) > 1e-6,
        "grand_boule fell silent after the guarded voice-steal crossfade"
    );
}

#[test]
fn grand_boule_saturated_steal_tail_pool_does_not_allocate() {
    use daw_dsp::grand_boule::GrandBouleInstance;

    const VOICES: u8 = 64;
    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, VOICES as u32);
    for channel in 0..VOICES {
        instance.note_on_with_channel(60, 0.8, channel);
    }

    let mut output = std::ptr::null();
    assert_no_alloc(|| {
        for channel in VOICES..(VOICES * 2) {
            instance.note_on_with_channel(60, 0.8, channel);
        }
        output = instance.process(BLOCK as u32);
    });

    let out = unsafe { read_output(output, BLOCK) };
    assert_all_finite(&out, "grand_boule saturated steal-tail pool");
    assert!(
        peak(&out) > 1e-6,
        "grand_boule fell silent while rendering the saturated steal-tail pool"
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
    instance.set_param("fat", 1.0);

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

/// The guard above runs Knead in its *shipped default* configuration —
/// formant preservation on, retune speed 0 — and neither of the two branches
/// those controls open is reached there. `grain_rate != 1.0` is a separate
/// grain loop with a fractional source read, and a retune glide in flight is a
/// per-frame `exp()` plus a shift the analysis gate has to keep engaged after
/// the target has already left. Both are audio-thread code and both need their
/// own allocation guard, driven at a *non-default* value, with the shift target
/// stepping inside the guarded region so the glide is actively unwinding rather
/// than settled.
#[test]
fn knead_process_does_not_allocate_with_formant_tracking_and_a_glide_in_flight() {
    use daw_dsp::knead::KneadInstance;

    let mut instance = KneadInstance::new(SAMPLE_RATE);
    instance.set_formant_preserve(false);
    instance.set_retune_speed_ms(200.0);
    instance.set_shift_semitones(4.0);

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
        assert_all_finite(&out, "knead formant/glide");
    }

    assert_no_alloc(|| {
        for block in 24..(24 + GUARDED_BLOCKS) {
            // Step the target mid-region, both directions, so the glide is
            // never settled while the guard is watching.
            if block == 30 {
                instance.set_shift_semitones(-3.0);
            }
            if block == 40 {
                instance.set_shift_semitones(7.0);
            }
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
    assert_all_finite(&out, "knead formant/glide");
    assert!(
        peak(&out) > 1e-4,
        "knead fell silent, so the guarded region did not exercise the formant-tracking grain"
    );
}

#[test]
fn levain_process_does_not_allocate_with_notes_held() {
    use daw_dsp::levain::LevainInstance;

    let mut owner = LevainInstance::new(SAMPLE_RATE, 8);
    owner.begin_sample_bank("violin-1");

    // Publish one real looping bank, attach it to a second instance, then drop
    // the publisher. The guarded render therefore exercises the shared-bank
    // follower path and proves its Arc owns the PCM independently.
    let frame_count = 4_800_u32;
    let sample: Vec<f32> = (0..frame_count)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let sample_id = owner
        .add_sample(sample, frame_count, 1, SAMPLE_RATE)
        .expect("test sample should fit the bank");
    owner.add_zone(
        0,           // zone_id
        sample_id,   // sample_id
        0,           // articulation_id
        69,          // root_note
        0.0,         // tune_cents
        0,           // lo_key
        127,         // hi_key
        0,           // lo_vel
        127,         // hi_vel
        0,           // rr_pos
        1,           // rr_len
        0,           // mic_id
        false,       // is_release
        1,           // loop_mode: forward, so the voice never runs out of sample
        0,           // loop_start
        frame_count, // loop_end
        0,           // loop_crossfade
        0.0,         // gain_db
        0.005,       // attack
        0.1,         // decay
        1.0,         // sustain
        0.3,         // release
    );
    assert!(owner.build_zone_map(1, 1));
    assert!(owner.publish_sample_bank("levain-rt-shared-bank"));
    assert!(owner.commit_sample_bank());

    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");
    assert!(instance.attach_sample_bank("levain-rt-shared-bank"));
    instance.add_zone(
        0,
        sample_id,
        0,
        69,
        0.0,
        0,
        127,
        0,
        127,
        0,
        1,
        0,
        false,
        1,
        0,
        frame_count,
        0,
        0.0,
        0.005,
        0.1,
        1.0,
        0.3,
    );
    assert!(instance.build_zone_map(1, 1));
    assert!(instance.commit_sample_bank());
    drop(owner);

    // Drive the macro-mapped Tone / Attack / Release slots off their centre
    // positions. Each is the identity at 0.5 — Tone takes its tilt section out
    // of the path entirely — so a guard run at defaults would never execute
    // them.
    instance.set_param("tone", 0.85);
    instance.set_param("attack", 0.2);
    instance.set_param("release", 0.9);

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

/// The guard above holds two notes for its whole run, so it never executes a
/// note-off or a slur — `LevainVoice::release` (and the `exit_loop` on each of
/// its three streams) and `start_crossfade` (and its `SamplePlayback` clone and
/// `seek_to`) both sit outside it. In the worklet those run on the audio thread
/// like everything else, from the message drain inside `process`, so they are
/// under the same contract and need the same proof.
#[test]
fn levain_note_lifecycle_does_not_allocate_on_slurs_and_note_offs() {
    use daw_dsp::levain::LevainInstance;

    let mut instance = LevainInstance::new(SAMPLE_RATE, 8);
    instance.begin_sample_bank("violin-1");

    let frame_count = 4_800_u32;
    let sample: Vec<f32> = (0..frame_count)
        .map(|i| (i as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect();
    let sample_id = instance
        .add_sample(sample, frame_count, 1, SAMPLE_RATE)
        .expect("test sample should fit the bank");
    instance.add_zone(
        0,           // zone_id
        sample_id,   // sample_id
        0,           // articulation_id
        69,          // root_note
        0.0,         // tune_cents
        0,           // lo_key
        127,         // hi_key
        0,           // lo_vel
        127,         // hi_vel
        0,           // rr_pos
        1,           // rr_len
        0,           // mic_id
        false,       // is_release
        1,           // loop_mode: forward, so a held note never runs out of sample
        0,           // loop_start
        frame_count, // loop_end
        0,           // loop_crossfade
        0.0,         // gain_db
        0.005,       // attack
        0.1,         // decay
        1.0,         // sustain
        0.3,         // release
    );
    assert!(instance.build_zone_map(1, 1));
    assert!(instance.commit_sample_bank());

    let warmup = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&warmup, "levain note lifecycle");

    assert_no_alloc(|| {
        for _ in 0..64 {
            // A note, then a second note under it: a whole tone apart is
            // inside `MAX_LEGATO_INTERVAL` and no transition sample is
            // registered, so this takes the synthetic-glide branch and runs
            // `start_crossfade` -> `seek_to`.
            instance.note_on(60, 100);
            instance.process(BLOCK as u32);
            instance.note_on(62, 100);
            instance.process(BLOCK as u32);
            // Both note-offs run `release()` -> `exit_loop` on all three
            // streams while the crossfade is still in flight.
            instance.note_off(62);
            instance.note_off(60);
            instance.process(BLOCK as u32);
        }
    });

    let out = unsafe { read_output(instance.process(BLOCK as u32), BLOCK) };
    assert_all_finite(&out, "levain note lifecycle");
    assert!(
        peak(&out) > 1e-6,
        "levain fell silent across the guarded lifecycle, so the guard did not \
         exercise the slur and release paths it exists to cover"
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
