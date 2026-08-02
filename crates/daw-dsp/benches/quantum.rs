//! What one AudioWorklet quantum of device DSP costs.
//!
//! The budget an `AudioWorkletProcessor` has to render 128 frames at 48 kHz is
//! 128 / 48_000 = 2.667 ms of wall clock. `grandBouleEngineWorker.ts` asserts
//! that Grand Boule cannot meet it and must therefore render on a dedicated
//! Web Worker behind a SharedArrayBuffer ring, unlike every other device in the
//! project. That assertion had never been measured. This bench measures it,
//! against Fermenter — the other polyphonic instrument, which runs in a plain
//! worklet today — so the Grand Boule figure is read against a shipped worklet
//! load rather than against an abstract budget. Grinder is included as a table
//! row only: it is a monophonic effect with no voice pool, so it can answer
//! "does *some* shipped device fit", which is not the question.
//!
//! A native aarch64/x86 number is a lower bound, not the answer: production
//! runs this compiled to wasm inside a browser worklet. The browser figure is
//! taken separately by driving the same `*Instance::process(128)` exports in
//! headless Chromium.
//!
//! What these numbers do and do not establish
//! ------------------------------------------
//! They establish *compute cost per quantum*. They do not observe a dropout.
//! No underrun and no over-budget render was ever caught in the act:
//! `AudioContext.renderCapacity` is not exposed in the Chromium the harness
//! drives, and the leg that runs inside a real `AudioWorkletGlobalScope` runs
//! on an `OfflineAudioContext`, which has no deadline. So the correct claim is
//! that the compute exceeds the budget, and that a dropout follows from that —
//! inferred from the cost, not measured.
//!
//! 64 voices is the common case, not the worst case
//! ------------------------------------------------
//! `GrandBouleEngine::note_off` skips `voice.note_off()` entirely while
//! `pedals.sustain_position() > 0.5`. With the sustain pedal down, released
//! notes stay `VoiceStage::Active` at `amplitude == 1.0` and keep paying the
//! full `Standard`-tier cost, so ordinary pedalled playing walks the pool up to
//! 64 within a few bars and holds it there. The 64-voice row is what pedalled
//! piano costs, not an artificial ceiling.
//!
//! Sounding voices, not allocated ones
//! -----------------------------------
//! A voice that has been `note_on`'d and is still ringing costs what a real one
//! costs; an allocated-but-silent slot does not. `PianoVoice::tick` returns
//! immediately when `stage == Idle`, and `MasterSynth` skips idle voices too,
//! so "64 voices" only means something once the voices are actually running.
//! Each setup here therefore:
//!
//! 1. allocates the production pool size (Grand Boule 64, Fermenter 32),
//! 2. strikes `sounding` *distinct* notes and never releases them,
//! 3. renders a warm-up run before the timed region, and
//! 4. verifies occupancy before benchmarking — Fermenter through its own
//!    `active_voices()` export, Grand Boule through output RMS plus the
//!    structural argument in `verify_grand_boule_voices_stay_sounding`.
//!
//! Holding the notes is what makes the timed region stationary. A held Grand
//! Boule voice sits in `VoiceStage::Active` with `amplitude` pinned at 1.0, so
//! it never crosses the `< 0.3` / `< 0.05` thresholds that would demote it from
//! `VoiceQuality::Standard` to a cheaper tier mid-run; a released voice decays
//! into the cheap tiers within a second and would quietly measure something
//! easier than what it claims to measure.

use std::hint::black_box;
use std::time::Duration;

use criterion::{criterion_group, criterion_main, BatchSize, BenchmarkId, Criterion};

use daw_dsp::fermenter::FermenterInstance;
use daw_dsp::grand_boule::engine::GrandBouleEngine;
use daw_dsp::grand_boule::GrandBouleInstance;
use daw_dsp::grinder::GrinderInstance;

const SAMPLE_RATE: f32 = 48_000.0;

/// One AudioWorklet render quantum.
const QUANTUM: usize = 128;

/// 128 frames at 48 kHz, in nanoseconds. The deadline every figure here is
/// measured against.
const BUDGET_NS: f64 = 2_666_667.0;

/// Grand Boule's production voice pool. `grandBouleEngineWorker.ts:207` builds
/// `new GrandBouleInstance(workerSampleRate, 64)`, not the crate's
/// `DEFAULT_VOICE_COUNT` of 32.
const GRAND_BOULE_POOL: usize = 64;

/// What `fermenterProcessor.ts:164` asks for: `new FermenterInstance(sampleRate, 32)`.
///
/// It does not get it. `MasterSynth::new(sample_rate, _max_voices)` discards the
/// argument, and each `Layer` owns a fixed `MAX_VOICES_PER_LAYER = 16` pool, so
/// the shipped single-layer patch tops out at 16 sounding voices no matter what
/// number the processor passes. This constant is kept at the production value
/// so the call site here matches production; the achievable counts below are
/// the real ones.
const FERMENTER_POOL: u32 = 32;

/// Layers stacked to reach a given sounding-voice count. `MasterSynth::note_on`
/// fans one note out to every active layer, and each layer holds 16 voices, so
/// 64 sounding Fermenter voices means 4 layers × 16 held notes — the only way
/// to put a 64-voice load on this synth at all.
///
/// Read the comparison off the **16-voice** row, not the 64-voice one, when the
/// question is production-vs-production. Production Fermenter is one layer, so
/// 16 is its real ceiling; the stacked rows are a charitable control that gives
/// Grand Boule the benefit of a load Fermenter never actually carries, and they
/// make the gap look four times smaller than it is.
const MAX_VOICES_PER_LAYER: usize = 16;

/// Blocks rendered before any timed region, to get past note-on transients
/// (Grand Boule's 80 ms pitch glide, the mechanical-noise bursts, Fermenter's
/// attack/decay stages) and into the steady state the engine spends its life
/// in. 128 blocks is ~341 ms of audio.
const WARMUP_BLOCKS: usize = 128;

/// Voice counts benchmarked. 64 is Grand Boule's full production pool; 32 is
/// both the crate default and Fermenter's whole pool; 0 isolates the
/// always-on shared blocks (soundboard, sympathetic bank, mechanical noise)
/// from per-voice cost.
const GRAND_BOULE_VOICE_COUNTS: [usize; 5] = [0, 1, 16, 32, 64];
const FERMENTER_VOICE_COUNTS: [usize; 5] = [0, 1, 16, 32, 64];

/// `count` distinct MIDI notes spread across the 88-key piano range (A0 = 21 to
/// C8 = 108). Distinctness matters: `GrandBouleEngine::note_on_with_pitch`
/// retriggers the *same* voice when the note is already held, so duplicated
/// notes would silently benchmark fewer sounding voices than requested.
fn spread_notes(count: usize) -> Vec<u8> {
    let mut notes = Vec::with_capacity(count);
    for index in 0..count {
        let note = 21 + (index * 87) / count.max(1);
        notes.push(note as u8);
    }
    notes
}

/// Peak absolute sample across both channels.
fn peak(left: &[f32], right: &[f32]) -> f32 {
    let mut worst = 0.0_f32;
    for sample in left.iter().chain(right.iter()) {
        worst = worst.max(sample.abs());
    }
    worst
}

fn rms(left: &[f32], right: &[f32]) -> f32 {
    let mut sum = 0.0_f64;
    for sample in left.iter().chain(right.iter()) {
        sum += (*sample as f64) * (*sample as f64);
    }
    (sum / (left.len() + right.len()) as f64).sqrt() as f32
}

// ---------------------------------------------------------------------------
// Grand Boule
// ---------------------------------------------------------------------------

/// A Grand Boule engine with the production pool size and `sounding` notes
/// struck and still held, warmed past the attack transient.
fn grand_boule_engine(sounding: usize) -> (GrandBouleEngine, Vec<f32>, Vec<f32>) {
    let mut engine = GrandBouleEngine::new(SAMPLE_RATE, GRAND_BOULE_POOL);
    for note in spread_notes(sounding) {
        engine.note_on(note, 0.8);
    }
    let mut left = vec![0.0_f32; QUANTUM];
    let mut right = vec![0.0_f32; QUANTUM];
    for _ in 0..WARMUP_BLOCKS {
        left.fill(0.0);
        right.fill(0.0);
        engine.process_block(&mut left, &mut right);
    }
    (engine, left, right)
}

/// The `#[wasm_bindgen]` wrapper the browser actually calls, in the same state.
/// `process` adds the two buffer clears and the two `sanitize_block` passes
/// that the raw `process_block` figure leaves out, so this is the number the
/// headless-Chromium harness is comparable with.
fn grand_boule_instance(sounding: usize) -> GrandBouleInstance {
    let mut instance = GrandBouleInstance::new(SAMPLE_RATE, GRAND_BOULE_POOL as u32);
    for note in spread_notes(sounding) {
        instance.note_on(note, 0.8);
    }
    for _ in 0..WARMUP_BLOCKS {
        instance.process(QUANTUM as u32);
    }
    instance
}

/// Evidence that the voices are ringing for the whole of a timed run, printed
/// before the benchmark so the numbers below are readable as a claim about
/// sounding voices.
///
/// `GrandBouleEngine` exposes no active-voice count, so occupancy is
/// established two ways. Structurally: every note struck here is distinct, so
/// the retrigger branch never fires; `PianoVoice::steal_priority` ranks `Idle`
/// above every sounding lifecycle/key-ownership class, so with 64 slots and at
/// most 64 notes the allocator always lands on an empty slot and never steals
/// a sounding one. Empirically: the RMS printed at the warm-up point and again
/// after ~10 s of rendered audio — longer than any criterion sample — shows the
/// strings still moving, and shows it growing with voice count.
///
/// That RMS falls a long way over those 10 s, because that is what a struck
/// piano string does. It does not make the voice cheaper. `amplitude` is the
/// *release* envelope, pinned at 1.0 for as long as the key is held, and it is
/// `amplitude` — not the string's physical level — that the progressive
/// quality demotion in `PianoVoice::tick` reads. A held voice therefore runs
/// the full `VoiceQuality::Standard` path indefinitely, which is why the timed
/// region is stationary and why the 64-voice figure does not decay away.
fn verify_grand_boule_voices_stay_sounding() {
    const LONG_RUN_BLOCKS: usize = 3_750; // 10 s at 48 kHz.

    eprintln!(
        "\n[verify] Grand Boule, pool {GRAND_BOULE_POOL}, held notes never released \
         (RMS of one quantum)"
    );
    eprintln!("[verify]  sounding | after warm-up | after 10 s |     peak @ 10 s");
    for sounding in GRAND_BOULE_VOICE_COUNTS {
        let (mut engine, mut left, mut right) = grand_boule_engine(sounding);
        let warm = rms(&left, &right);
        for _ in 0..LONG_RUN_BLOCKS {
            left.fill(0.0);
            right.fill(0.0);
            engine.process_block(&mut left, &mut right);
        }
        let late = rms(&left, &right);
        eprintln!(
            "[verify]  {sounding:>8} | {warm:>13.3e} | {late:>10.3e} | {:>15.3e}",
            peak(&left, &right)
        );
        if sounding > 0 {
            assert!(
                late > 1.0e-7,
                "Grand Boule fell silent at {sounding} voices after 10 s (RMS {late:.3e}); the \
                 benchmark below would be timing idle voices"
            );
        }
    }
}

fn bench_grand_boule_process_block(criterion: &mut Criterion) {
    verify_grand_boule_voices_stay_sounding();

    let mut group = criterion.benchmark_group("grand_boule/process_block_128");
    group.measurement_time(Duration::from_secs(8));
    for sounding in GRAND_BOULE_VOICE_COUNTS {
        let (mut engine, mut left, mut right) = grand_boule_engine(sounding);
        group.bench_with_input(
            BenchmarkId::from_parameter(sounding),
            &sounding,
            |bencher, _| {
                bencher.iter(|| {
                    // `process_block` sums into the buffers with `+=`; it is the
                    // caller's job to clear them, which is what
                    // `GrandBouleInstance::process` does before delegating here.
                    // Skipping it lets the buffers grow without bound across a
                    // run. That does not change the cost — the values stay
                    // finite, never reach denormals, and nothing reads them back
                    // into the engine — but a bench whose job is to be the
                    // trustworthy artifact should not render a signal that could
                    // not come out of the device.
                    left.fill(0.0);
                    right.fill(0.0);
                    engine.process_block(black_box(&mut left), black_box(&mut right));
                    black_box(&left);
                    black_box(&right);
                });
            },
        );
    }
    group.finish();
}

fn bench_grand_boule_instance(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("grand_boule/instance_process_128");
    group.measurement_time(Duration::from_secs(8));
    for sounding in GRAND_BOULE_VOICE_COUNTS {
        let mut instance = grand_boule_instance(sounding);
        group.bench_with_input(
            BenchmarkId::from_parameter(sounding),
            &sounding,
            |bencher, _| {
                bencher.iter(|| black_box(instance.process(black_box(QUANTUM as u32))));
            },
        );
    }
    group.finish();
}

/// Build the maximum transient workload: 64 sounding production voices plus
/// 64 preallocated one-millisecond steal tails. Distinct channels preserve the
/// same-pitch identities while forcing every tail slot active.
fn saturated_grand_boule_engine() -> (GrandBouleEngine, [f32; QUANTUM], [f32; QUANTUM]) {
    let mut engine = GrandBouleEngine::new(SAMPLE_RATE, GRAND_BOULE_POOL);
    for channel in 0..GRAND_BOULE_POOL as u8 {
        engine.note_on_with_channel(60, 0.8, channel);
    }
    for channel in GRAND_BOULE_POOL as u8..(GRAND_BOULE_POOL * 2) as u8 {
        engine.note_on_with_channel(60, 0.8, channel);
    }
    (engine, [0.0; QUANTUM], [0.0; QUANTUM])
}

fn bench_grand_boule_saturated_steal(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("grand_boule/saturated_steal_process_128");
    group.measurement_time(Duration::from_secs(8));
    group.sample_size(10);
    group.bench_function("64_voices_plus_64_tails", |bencher| {
        bencher.iter_batched(
            saturated_grand_boule_engine,
            |(mut engine, mut left, mut right)| {
                engine.process_block(black_box(&mut left), black_box(&mut right));
                black_box((left, right));
            },
            BatchSize::SmallInput,
        );
    });
    group.finish();
}

// ---------------------------------------------------------------------------
// Fermenter — a polyphonic synth that ships in a plain AudioWorklet today
// ---------------------------------------------------------------------------

/// A Fermenter holding `sounding` voices. The filter is opened and resonated
/// the way `engine_output_level.rs` drives it, so the ladder and the modulation
/// path are doing work rather than idling at a default that short-circuits.
///
/// Above 16 voices the load has to be built by stacking layers, because a
/// layer's pool is fixed at 16. `layers × notes` is chosen to hit `sounding`
/// exactly, keeping the notes distinct within a layer.
fn fermenter_instance(sounding: usize) -> FermenterInstance {
    let layers = sounding.div_ceil(MAX_VOICES_PER_LAYER).clamp(1, 4);
    let notes_per_layer = sounding / layers;
    assert_eq!(
        notes_per_layer * layers,
        sounding,
        "{sounding} Fermenter voices does not divide into {layers} layers of 16"
    );

    let mut instance = FermenterInstance::new(SAMPLE_RATE, FERMENTER_POOL);
    instance.set_param("num_layers", layers as f32);
    for layer in 0..layers {
        instance.set_param("active_layer", layer as f32);
        instance.set_param("cutoff", 4_000.0);
        instance.set_param("resonance", 0.4);
    }
    for note in spread_notes(notes_per_layer) {
        instance.note_on(note, 100);
    }
    for _ in 0..WARMUP_BLOCKS {
        instance.process(QUANTUM as u32);
    }
    instance
}

/// Fermenter exports its own sounding-voice count, so occupancy is read
/// directly rather than inferred.
fn verify_fermenter_voices_stay_sounding() {
    const LONG_RUN_BLOCKS: usize = 3_750;

    eprintln!(
        "\n[verify] Fermenter (constructed with max_voices={FERMENTER_POOL}, which the synth \
         ignores), held notes never released"
    );
    eprintln!("[verify]  requested | active after warm-up | active after 10 s");
    for sounding in FERMENTER_VOICE_COUNTS {
        let mut instance = fermenter_instance(sounding);
        let warm = instance.active_voices();
        for _ in 0..LONG_RUN_BLOCKS {
            instance.process(QUANTUM as u32);
        }
        let late = instance.active_voices();
        eprintln!("[verify]  {sounding:>9} | {warm:>20} | {late:>17}");
        assert_eq!(
            late as usize, sounding,
            "Fermenter holds {late} sounding voices, not the {sounding} requested"
        );
    }
}

fn bench_fermenter_instance(criterion: &mut Criterion) {
    verify_fermenter_voices_stay_sounding();

    let mut group = criterion.benchmark_group("fermenter/instance_process_128");
    group.measurement_time(Duration::from_secs(8));
    for sounding in FERMENTER_VOICE_COUNTS {
        let mut instance = fermenter_instance(sounding);
        group.bench_with_input(
            BenchmarkId::from_parameter(sounding),
            &sounding,
            |bencher, _| {
                bencher.iter(|| black_box(instance.process(black_box(QUANTUM as u32))));
            },
        );
    }
    group.finish();
}

// ---------------------------------------------------------------------------
// Grinder — an amp sim that ships in a plain AudioWorklet today
// ---------------------------------------------------------------------------

/// Grinder is a monophonic *effect*: it transforms one input signal and has no
/// voice pool, so a voice-count sweep is meaningless for it and none is
/// reported. What it does have is an amp model, and the models differ in cost
/// (oversampling, triode stages, neural capture), so the sweep is over models
/// at the fixed operating point `engine_output_level.rs` pins: lead channel,
/// gain 8.2, master 8.0, tone controls centred.
const GRINDER_MODELS: [(&str, f32); 3] = [
    ("clean_twin", 0.0),
    ("lead_jcm", 2.0),
    ("rectifier", 4.0),
];

fn grinder_instance(amp_model: f32) -> GrinderInstance {
    let mut instance = GrinderInstance::new(SAMPLE_RATE);
    instance.set_param("ampModel", amp_model);
    instance.set_param("channel", 2.0);
    instance.set_param("gain", 8.2);
    instance.set_param("master", 8.0);
    instance.set_param("bass", 5.0);
    instance.set_param("mid", 5.0);
    instance.set_param("treble", 5.0);
    instance.set_param("fat", 0.0);

    // A 220 Hz guitar-level tone at about -12 dBFS, written once into the
    // instance's input buffers. Grinder reads the same 128 frames every block,
    // which is fine for cost: the circuit runs the same code either way.
    let left_ptr = instance.get_input_left_ptr();
    let right_ptr = instance.get_input_right_ptr();
    for frame in 0..QUANTUM {
        let phase = 2.0 * std::f32::consts::PI * 220.0 * (frame as f32) / SAMPLE_RATE;
        let sample = 0.25 * phase.sin();
        // SAFETY: both pointers come from `Vec<f32>` fields of `instance` that
        // are `MAX_GRINDER_BLOCK_SIZE` (2048) long, and `frame < QUANTUM`.
        unsafe {
            *left_ptr.add(frame) = sample;
            *right_ptr.add(frame) = sample;
        }
    }

    for _ in 0..WARMUP_BLOCKS {
        instance.process(QUANTUM as u32);
    }
    instance
}

/// Grinder has no voice count to verify; what has to be true is that the amp is
/// actually passing signal rather than sitting at an operating point that
/// short-circuits the circuit.
fn verify_grinder_is_passing_signal() {
    eprintln!("\n[verify] Grinder, lead channel, gain 8.2 (output dB at the engine boundary)");
    for (name, model) in GRINDER_MODELS {
        let instance = grinder_instance(model);
        let output_db = instance.get_output_db();
        eprintln!("[verify]  {name:>12} | {output_db:>8.2} dBFS");
        assert!(
            output_db > -60.0,
            "Grinder {name} outputs {output_db:.2} dBFS — effectively silent, so the benchmark \
             would be timing an amp with nothing going through it"
        );
    }
}

fn bench_grinder_instance(criterion: &mut Criterion) {
    verify_grinder_is_passing_signal();

    let mut group = criterion.benchmark_group("grinder/instance_process_128");
    group.measurement_time(Duration::from_secs(8));
    for (name, model) in GRINDER_MODELS {
        let mut instance = grinder_instance(model);
        group.bench_function(BenchmarkId::from_parameter(name), |bencher| {
            bencher.iter(|| black_box(instance.process(black_box(QUANTUM as u32))));
        });
    }
    group.finish();

    eprintln!(
        "\n[budget] one 128-frame quantum at 48 kHz = {:.3} ms of wall clock",
        BUDGET_NS / 1.0e6
    );
}

criterion_group!(
    benches,
    bench_grand_boule_process_block,
    bench_grand_boule_instance,
    bench_grand_boule_saturated_steal,
    bench_fermenter_instance,
    bench_grinder_instance,
);
criterion_main!(benches);
