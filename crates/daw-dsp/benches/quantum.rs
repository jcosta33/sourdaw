//! What one AudioWorklet quantum of device DSP costs, for every device.
//!
//! # The budget, and why it is that number
//!
//! **2.667 ms.** An `AudioWorkletProcessor` is called once per render quantum
//! and must return before the next one is due. A quantum is 128 frames, fixed
//! by the Web Audio specification, and the project runs at 48 kHz, so the wall
//! clock available to render one is 128 / 48_000 = 2.6667 ms. Nothing about
//! this is a policy choice that can be revisited: it is the sample rate and the
//! spec. Exceeding it does not degrade quality, it drops audio.
//!
//! The whole budget belongs to the *sum* of everything on the audio thread, not
//! to any one device. A row at 40% of budget is not comfortable — three of them
//! and a reverb is over.
//!
//! # Two legs, and only one of them answers the question
//!
//! Production compiles this DSP to wasm and runs it in a browser worklet. A
//! native aarch64 figure is a lower bound, not the answer — the original
//! measurement put wasm at 2.17x native. This file is the **native** leg;
//! `benches/wasm/` is the wasm leg, and it drives the same devices through the
//! committed `_bg.wasm` artifacts inside a real `AudioWorkletGlobalScope`:
//!
//! ```text
//! node crates/daw-dsp/benches/wasm/run.mjs --json /tmp/wasm-cost.json
//! CARGO_PROFILE_BENCH_LTO=false cargo bench -p daw-dsp --bench quantum
//! ```
//!
//! Both legs are recorded in **`benches/quantum-cost-table.md`**, with the
//! machine, the browser and the `main` SHA every number was taken at. **A number
//! without its machine is not a measurement.** Read that file before arguing
//! from any figure here: it carries the reference-project total, the
//! wasm-vs-native ratios, and the caveats that decide what the numbers mean.
//!
//! # The machine is part of the measurement, and it is never idle
//!
//! `cost_table` reads the 1-minute load average before and after its run and
//! **records** it beside every figure. It used to *gate* on it, and that was
//! right in intent and wrong in practice: the machine this runs on sustains a
//! load average of 20-180 from ordinary desktop applications, so the gate meant
//! no table ever printed.
//!
//! What replaces it is one-directional and stronger. **Contention only ever
//! adds time to a sample, it never removes it.** So from a single contended
//! run:
//!
//! * the **floor** (1st percentile) is a genuine **lower bound** on the device,
//! * the **median under load** is a genuine **upper bound** on what a quiet
//!   machine would show.
//!
//! Both are valid, and together they bracket the truth without ever needing an
//! idle machine. If the upper bound already fits the budget, the device fits;
//! if the floor already exceeds it, the device cannot fit and no quieter
//! machine will change that.
//!
//! This is not a licence to ignore contention — the load is printed with every
//! row precisely so a later quiet-machine run can be *compared* rather than
//! confused with this one. Occupancy remains a hard gate, because a row that
//! was not sounding bounds nothing in either direction.
//!
//! Neither bound is a statement about deadlines. They bound compute. Whether
//! quanta are actually missed is AC-3's observation, which reads genuine
//! underruns from `AudioContext.playbackStats` on a live context.
//!
//! `CARGO_PROFILE_BENCH_LTO=false` is required and is not optional cleanliness:
//! the workspace release profile sets `lto = true`, which conflicts with the
//! `-C embed-bitcode=no` criterion's build passes, and `cargo bench` fails
//! without it. Do not fix that by editing `[profile.release]` — that profile is
//! hashed into all four wasm crate-source fingerprints and editing it
//! invalidates every committed wasm artifact.
//!
//! # Which devices are here, and which are not
//!
//! Every `#[wasm_bindgen]` render export in this crate: Bacteria, Crumbs,
//! Crust, Fermenter, Gluten, Grand Boule, Grinder, Knead, Levain, Proof,
//! Toaster.
//!
//! That sentence was false for as long as Crust had an engine, because the
//! list is written by hand and nothing checked it. `tests/quantum_bench_census.rs`
//! now derives the population from the crate source and compares it against the
//! row ids in this file — two independently-sourced lists, per ADR 0015 rule 3 —
//! so the next device added without a row fails a test instead of quietly
//! shrinking the table.
//!
//! **ProofChamber and Scoring are measured in the wasm leg only, and natively
//! by `crates/proof-chamber/tests/quantum_cost.rs` and
//! `crates/scoring/tests/quantum_cost.rs` rather than here.** They live in
//! sibling crates, and adding them as dev-dependencies of `daw-dsp` would pull
//! their sources into `daw-dsp`'s wasm crate-source hash, so that editing a
//! reverb would invalidate the DSP crate's committed artifacts. A coupled gate
//! is worse than a bench split across three files.
//!
//! **Yeast and CvGate are absent because they have no Rust engine at all.**
//! Their cost is JavaScript, which this instrument does not measure and does
//! not claim to. Crust was listed here on the same grounds and had stopped
//! being true; it has a row now.
//!
//! # A row measures the configuration it is set to, not the device
//!
//! Two rows here were timing a device with the expensive part switched off,
//! and both passed every gate this file has while doing it:
//!
//! * **Levain** was loaded through the direct pool rather than the staged-bank
//!   protocol production uses, so `commit_sample_bank` never ran, the realism
//!   layer stayed at `Instrument::Other`, and all five realism stages
//!   early-returned on a zero amount. See `load_levain_bank`.
//! * **Bacteria** shipped a single row at the constructor defaults, where
//!   every creative stage is disabled. See `row_bacteria` and
//!   `row_bacteria_smudge`.
//!
//! Neither was caught by occupancy: the device was sounding, the voice count
//! was right, the RMS was healthy. Occupancy proves a row was *running*; it
//! proves nothing about *what* was running. When adding a row, ask what the
//! smallest change is that switches off the thing you meant to measure and
//! leaves every assertion here passing — and then set the parameter that makes
//! that change visible.
//!
//! # Distribution, not a mean
//!
//! A worklet that misses one quantum in a hundred still glitches, so every row
//! reports median, p95, p99 and max, and states its sample count. **The max is
//! not a worst case.** 20 000 samples is 53 s of one device's rendered audio; a
//! session renders on the order of 1.7M quanta an hour. The tail is
//! understated, not bounded.
//!
//! # The precedent this file exists because of
//!
//! `grandBouleEngineWorker.ts` asserts
//! that Grand Boule cannot meet it and must therefore render on a dedicated
//! Web Worker behind a SharedArrayBuffer ring, unlike every other device in the
//! project. That assertion had never been measured. This bench measures it,
//! against Fermenter — the other polyphonic instrument, which runs in a plain
//! worklet today — so the Grand Boule figure is read against a shipped worklet
//! load rather than against an abstract budget. Grinder is included as a table
//! row only: it is a monophonic effect with no voice pool, so it can answer
//! "does *some* shipped device fit", which is not the question.
//!
//! # What these numbers do and do not establish
//!
//! They establish *compute cost per quantum*. They do not observe a dropout.
//! No underrun and no over-budget render is caught in the act here:
//! `AudioContext.renderCapacity` is not exposed in the Chromium this harness
//! drives, and the leg that runs inside a real `AudioWorkletGlobalScope` runs
//! on an `OfflineAudioContext`, which has no deadline. So the correct claim
//! from *this file* is that the compute exceeds the budget, and that a dropout
//! follows from that — inferred from the cost, not measured. **"Its compute
//! exceeds the budget" and "it misses the deadline" are different claims.**
//!
//! The measured half now exists elsewhere. `scripts/measureRenderDeadline.ts`
//! observes real deadline misses on a live `AudioContext` via
//! `AudioContext.playbackStats` (`underrunEvents` / `underrunDuration`), with
//! an in-budget control leg that records none. `renderCapacity` is still
//! absent — on stable Chrome as well as on the bundled Chromium, under every
//! relevant blink feature flag — so that harness, not this one, is where the
//! deadline claim comes from. Keep the two claims apart: cost lives here,
//! deadline misses live there.
//!
//! # 64 voices is the common case, not the worst case
//!
//! `GrandBouleEngine::note_off` skips `voice.note_off()` entirely while
//! `pedals.sustain_position() > 0.5`. With the sustain pedal down, released
//! notes stay `VoiceStage::Active` at `amplitude == 1.0` and keep paying the
//! full `Standard`-tier cost, so ordinary pedalled playing walks the pool up to
//! 64 within a few bars and holds it there. The 64-voice row is what pedalled
//! piano costs, not an artificial ceiling.
//!
//! # Sounding voices, not allocated ones — and still sounding at the end
//!
//! A voice that has been `note_on`'d and is still ringing costs what a real one
//! costs; an allocated-but-silent slot does not. `PianoVoice::tick` returns
//! immediately when `stage == Idle`, and `MasterSynth` skips idle voices too,
//! so "64 voices" only means something once the voices are actually running.
//! Every row therefore drives its device into an audibly active state and
//! **verifies occupancy after the timed run**, through the device's own
//! `active_voices()` export where it has one and output RMS where it does not.
//! A row that fails its check fails the bench rather than printing a number.
//!
//! Holding notes is not sufficient, and the cost table found where it stops
//! being sufficient. Over the 53 s a row is timed for, 64 held Grand Boule
//! notes decay to an output RMS of 1e-9 and 16 struck Toaster pads decay to
//! *exact zero* — while still paying full price, because the quality demotion
//! reads the release envelope, which is pinned at 1.0 with the key down. Both
//! rows now re-strike once a second, which is what a pedalled piano and a drum
//! machine do anyway. Fermenter sustains, and Levain and Crumbs loop their
//! zones, so those three hold their level without help.
//!
//! Two things the setups turned up, both recorded rather than smoothed over:
//!
//! * **Fermenter's constructed 32 voices are now reachable.** `MasterSynth::new`
//!   enforces the instance-wide ceiling across layers, so the shipped
//!   single-layer patch can use all 32 voices it requests.
//! * **Levain's constructed 64 voices settle at 32.** Legato ships enabled and
//!   collapses any note within 12 semitones of a held one onto the held voice,
//!   so 64 notes spread over 88 keys become 32 sounding voices.

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

/// What `fermenterProcessor.ts:170` asks for: `new FermenterInstance(sampleRate, 32)`.
///
/// `MasterSynth` enforces this as an instance-wide ceiling across every active
/// layer. The shipped single-layer patch can therefore sound all 32 voices.
const FERMENTER_POOL: u32 = 32;

/// Production's configured instance-wide ceiling. Higher synthetic rows raise
/// the constructor ceiling explicitly rather than relying on hidden layer
/// capacity.
const PRODUCTION_FERMENTER_VOICE_CEILING: usize = FERMENTER_POOL as usize;

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
/// Multi-layer rows distribute the instance-wide ceiling across layers.
/// `layers × notes` is chosen to hit `sounding` exactly, keeping the notes
/// distinct within each layer.
fn fermenter_instance(sounding: usize) -> FermenterInstance {
    let layers = sounding
        .div_ceil(PRODUCTION_FERMENTER_VOICE_CEILING)
        .clamp(1, 4);
    let notes_per_layer = sounding / layers;
    assert_eq!(
        notes_per_layer * layers,
        sounding,
        "{sounding} Fermenter voices does not divide evenly into {layers} layers"
    );

    let voice_ceiling = sounding.max(PRODUCTION_FERMENTER_VOICE_CEILING) as u32;
    let mut instance = FermenterInstance::new(SAMPLE_RATE, voice_ceiling);
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
        "\n[verify] Fermenter (production max_voices={FERMENTER_POOL}; synthetic rows raise \
         the enforced instance-wide ceiling as needed), held notes never released"
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
const GRINDER_MODELS: [(&str, f32); 3] =
    [("clean_twin", 0.0), ("lead_jcm", 2.0), ("rectifier", 4.0)];

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

// ---------------------------------------------------------------------------
// The rest of the devices, and the cost table
// ---------------------------------------------------------------------------

/// Untimed quanta rendered before any distribution is sampled.
///
/// Longer than `WARMUP_BLOCKS`, which exists only to clear a note-on transient.
/// This one also has to get the *branch predictors and caches* into the state a
/// device spends its life in, and it is chosen to match the wasm leg exactly so
/// the two columns are comparable. The harness does not take it on trust: every
/// row reports the mean of its first and last 500 timed samples, so a run that
/// was still settling shows up as a drifting mean rather than hiding in the
/// average.
const TABLE_WARMUP_QUANTA: usize = 4_000;

/// Timed quanta per row. 20 000 x 128 frames is 53 s of rendered audio.
const TABLE_SAMPLE_QUANTA: usize = 20_000;

/// The one-minute load average, or `None` where it cannot be read.
///
/// Shelling out to `uptime` once, before and after the table, is not elegant.
/// It is here because the first full run of this table was taken while another
/// agent worktree was running the whole vitest suite: load average 25 on a
/// 12-core machine, every core saturated. Grand Boule's p99 came out at 17.9 ms
/// against a 1.1 ms median, and *nothing in the output said why*. The table
/// looked like a measurement of a device and was partly a measurement of the
/// scheduler.
///
/// A parseable, dependency-free load reading is worth an `uptime` fork.
fn load_average() -> Option<f64> {
    let output = std::process::Command::new("/usr/bin/uptime")
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_string();
    let tail = text
        .rsplit_once("load averages:")
        .or_else(|| text.rsplit_once("load average:"))?
        .1;
    tail.split_whitespace()
        .next()?
        .trim_end_matches(',')
        .parse()
        .ok()
}

/// Load above which the table refuses to stand behind its own numbers.
///
/// Half the logical cores. The bench itself is single-threaded, so a quiet
/// machine sits near 1; anything above this means the DSP is sharing cores with
/// something, and a per-quantum figure taken under that condition is a
/// measurement of the two together.
fn load_ceiling() -> f64 {
    std::thread::available_parallelism().map_or(4.0, |cores| cores.get() as f64 / 2.0)
}

/// A device's per-quantum cost distribution, in nanoseconds.
struct Distribution {
    n: usize,
    /// 1st percentile — the contention-free floor, and the primary figure.
    ///
    /// Contention only ever adds time to a sample, never removes it, so the low
    /// end of the distribution is a genuine lower bound on the device and is
    /// obtainable on a machine that is never idle. Not the raw minimum, for
    /// symmetry with the wasm leg, where the extreme low end can be dragged
    /// down by a stall of the clock thread; `Instant` has no such failure mode,
    /// so here the two agree closely and both are printed.
    floor: f64,
    min: f64,
    median: f64,
    p95: f64,
    p99: f64,
    p999: f64,
    max: f64,
    /// Mean over every sample — the **amortised** per-quantum cost, and the
    /// only figure that is right for a device that does its work in blocks.
    ///
    /// Added because a row exposed the gap. Bacteria in Smudge mode runs an
    /// overlap-add STFT: most quanta only fill the window and cost ~19 us,
    /// and one in a handful runs the transform and costs hundreds. Its median
    /// is 18.9 us and its mean is ~130 us — a 7x spread, and the median is the
    /// wrong one. Every other row here is flat enough that mean and median
    /// agree, which is exactly why nothing noticed.
    ///
    /// Read `mean` for "can the thread sustain this", and `p99`/`max` for
    /// "does any single quantum miss". `median` answers neither for a block
    /// device, and it is kept only because it is the honest upper bound on a
    /// quiet machine for the flat rows.
    mean: f64,
    first_five_hundred_mean: f64,
    last_five_hundred_mean: f64,
}

impl Distribution {
    /// Whether this row's work arrives in bursts rather than evenly.
    ///
    /// A flat device has mean ~= median. A block device does not, and summing
    /// its median into a thread total understates it by the ratio below. The
    /// 1.5x threshold is well clear of the <=1.1x every flat row here shows
    /// and well under the ~7x Smudge shows, so it separates the two classes
    /// without needing a per-device list.
    fn is_bursty(&self) -> bool {
        self.median > 0.0 && self.mean / self.median > 1.5
    }
}

fn quantile(sorted: &[u64], fraction: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let rank = (fraction * sorted.len() as f64).ceil() as usize;
    let index = rank.saturating_sub(1).min(sorted.len() - 1);
    sorted[index] as f64
}

fn mean_of(samples: &[u64]) -> f64 {
    if samples.is_empty() {
        return f64::NAN;
    }
    samples.iter().map(|value| *value as f64).sum::<f64>() / samples.len() as f64
}

fn summarise(mut samples: Vec<u64>) -> Distribution {
    let head = mean_of(&samples[..500.min(samples.len())]);
    let tail_start = samples.len().saturating_sub(500);
    let tail = mean_of(&samples[tail_start..]);
    samples.sort_unstable();
    Distribution {
        n: samples.len(),
        floor: quantile(&samples, 0.01),
        min: *samples.first().unwrap_or(&0) as f64,
        median: quantile(&samples, 0.5),
        p95: quantile(&samples, 0.95),
        p99: quantile(&samples, 0.99),
        p999: quantile(&samples, 0.999),
        max: *samples.last().unwrap_or(&0) as f64,
        mean: mean_of(&samples),
        first_five_hundred_mean: head,
        last_five_hundred_mean: tail,
    }
}

/// The harness's own cost: `Instant::now()` twice with nothing in between.
///
/// Inside every figure below, and reported as its own row rather than assumed
/// negligible — a 5 us device read against a 30 ns floor is a different claim
/// from a 5 us device read against a 500 ns one.
fn timer_floor() -> Distribution {
    let mut samples = Vec::with_capacity(TABLE_SAMPLE_QUANTA);
    for _ in 0..TABLE_SAMPLE_QUANTA {
        let start = std::time::Instant::now();
        samples.push(black_box(start.elapsed()).as_nanos() as u64);
    }
    summarise(samples)
}

/// Time `render` for `TABLE_SAMPLE_QUANTA` quanta after `TABLE_WARMUP_QUANTA`
/// discarded ones, feeding the device each block *outside* the timed region.
///
/// `feed` is untimed on purpose and the wasm leg does the same: a worklet pays
/// the input marshalling against `inputs[0]` whichever device consumes it, so
/// including it would attribute a host cost to a device. `feed` is also where a
/// one-shot instrument re-strikes — see `row_toaster` and `row_grand_boule`.
///
/// **The warm-up is the timed loop, run twice and the first pass thrown away.**
/// An earlier version warmed up through a *different*, untimed loop body, and
/// every row's first 500 timed samples came out 20-60% above its own median:
/// the timed loop's own branch prediction and instruction cache were cold even
/// though the DSP was hot. Warming up through a cheaper path than the one being
/// measured is a way to measure the transition into the real path.
fn sample_quanta<D>(
    device: &mut D,
    feed: &mut dyn FnMut(&mut D, usize),
    render: &mut dyn FnMut(&mut D) -> *const f32,
) -> Vec<u64> {
    let mut run = |device: &mut D, from: usize, count: usize| {
        let mut samples = Vec::with_capacity(count);
        for block in 0..count {
            feed(device, from + block);
            let start = std::time::Instant::now();
            let produced = render(device);
            let elapsed = start.elapsed();
            black_box(produced);
            samples.push(elapsed.as_nanos() as u64);
        }
        samples
    };
    black_box(run(device, 0, TABLE_WARMUP_QUANTA));
    run(device, TABLE_WARMUP_QUANTA, TABLE_SAMPLE_QUANTA)
}

/// Blocks between re-strikes for a device whose voices decay.
///
/// 375 quanta is one second of audio. Two rows need it, and both are findings
/// in their own right: over the 53 s a row is timed for, a struck Grand Boule
/// voice decays to an RMS of 1e-9 and 16 struck Toaster pads decay to *exact
/// zero*. An earlier version of this file held them and reported the cost of an
/// instrument that had stopped making sound — which is precisely the trap its
/// own header warns about. Re-striking is also what the devices are for: a
/// pedalled piano and a drum machine both retrigger constantly.
const RESTRIKE_INTERVAL_QUANTA: usize = 375;

/// The excitation `tests/engine_output_level.rs` uses, duplicated here rather
/// than shared because a bench cannot import a sibling integration test. The
/// wasm leg's `deviceRecipes.js` carries the same function for the same reason.
fn excitation(frame: usize) -> (f32, f32) {
    let t = frame as f32 / SAMPLE_RATE;
    let fundamental = (t * 110.0 * std::f32::consts::TAU).sin();
    let second = (t * 220.0 * std::f32::consts::TAU).sin() * 0.5;
    let third = (t * 440.0 * std::f32::consts::TAU).sin() * 0.25;
    let phase = (frame % 4_800) as f32 / SAMPLE_RATE;
    let pick = (-phase * 60.0).exp() * 0.6;
    let body = (fundamental + second + third) * 0.28;
    (body * (1.0 + pick), body * (1.0 + pick * 0.8))
}

/// # Safety
/// `left` and `right` must each point to at least `QUANTUM` writable `f32`s.
unsafe fn fill_input(left: *mut f32, right: *mut f32, block: usize) {
    for frame in 0..QUANTUM {
        let (l, r) = excitation(block * QUANTUM + frame);
        *left.add(frame) = l;
        *right.add(frame) = r;
    }
}

/// # Safety
/// `left` and `right` must each point to at least `QUANTUM` readable `f32`s.
unsafe fn rms_at(left: *const f32, right: *const f32) -> f32 {
    let mut sum = 0.0_f64;
    for frame in 0..QUANTUM {
        let l = *left.add(frame) as f64;
        let r = *right.add(frame) as f64;
        sum += l * l + r * r;
    }
    (sum / (2 * QUANTUM) as f64).sqrt() as f32
}

/// One row of the cost table.
struct Row {
    id: &'static str,
    label: &'static str,
    /// Where production sets this row's load parameter, or why it has none.
    load: &'static str,
    distribution: Distribution,
    /// Occupancy evidence taken *after* the timed run, so a pool that drained
    /// mid-run cannot be reported as a steady-state cost.
    occupancy: String,
    /// Whether that evidence is acceptable. A false here fails the bench.
    occupancy_ok: bool,
}

/// Build an effect row: an engine whose input arrives through raw wasm-facing
/// pointers, driven with the shared excitation.
macro_rules! effect_row {
    ($id:expr, $label:expr, $load:expr, $instance:expr) => {{
        let mut instance = $instance;
        let samples = sample_quanta(
            &mut instance,
            &mut |device, block| unsafe {
                fill_input(
                    device.get_input_left_ptr(),
                    device.get_input_right_ptr(),
                    block,
                )
            },
            &mut |device| device.process(QUANTUM as u32),
        );
        let level = unsafe { rms_at(instance.process(QUANTUM as u32), instance.get_right_ptr()) };
        Row {
            id: $id,
            label: $label,
            load: $load,
            distribution: summarise(samples),
            occupancy: format!("output RMS {level:.3e}"),
            occupancy_ok: level > 1.0e-5,
        }
    }};
}

/// Bacteria with its creative stages **off**, which is what
/// `BacteriaEngine::new` ships (`bacteria/engine.rs:220`,
/// `distortion_enabled: false`, and every sibling `*_enabled` flag beside it).
///
/// Kept as a row, and kept labelled for what it is. `bandCount` and `mix` set
/// the crossover and the wet/dry tap; they do not switch on a single processor.
/// So this row is the crossover, the alignment delays and the band sum — the
/// floor Bacteria costs before it does anything a user opened it for. Read it
/// as the floor, not as Bacteria's cost, and read `bacteria_smudge` below for
/// the other end.
fn row_bacteria() -> Row {
    effect_row!(
        "bacteria",
        "Bacteria (3 bands, mix 1.0, all stages off)",
        "effect; no voice pool; engine.rs:220 ships every stage disabled",
        {
            let mut i = daw_dsp::bacteria::BacteriaInstance::new(SAMPLE_RATE);
            i.set_param("bandCount", 3.0);
            i.set_param("mix", 1.0);
            i
        }
    )
}

/// Bacteria with the distortion stage engaged in **Smudge**, its STFT mode.
///
/// This row exists because the row above measures a configuration nobody uses,
/// and the header used to let a reader take that figure for Bacteria's cost.
/// Smudge is `DistortionMode::from_index(7)` (`bacteria/distortion.rs:41`) and
/// runs an overlap-add spectral blur through `stft::SmudgeProcessor` with a
/// 2048-sample window (`distortion.rs:92-99`), on every band — the most
/// expensive thing this device can be asked to do, and reachable from the
/// shipped panel.
///
/// Enabling distortion also puts the oversampler in the path
/// (`engine.rs:327-332`), so the two rows differ by the whole wet chain rather
/// than by one shaper. Bare parameter names broadcast to every band
/// (`engine.rs:50-52`), so three bands each carry a Smudge window here.
fn row_bacteria_smudge() -> Row {
    effect_row!(
        "bacteria_smudge",
        "Bacteria (3 bands, distortion on, Smudge/STFT)",
        "effect; no voice pool; distortionMode 7 = Smudge, distortion.rs:41",
        {
            let mut i = daw_dsp::bacteria::BacteriaInstance::new(SAMPLE_RATE);
            i.set_param("bandCount", 3.0);
            i.set_param("mix", 1.0);
            i.set_param("distortionEnabled", 1.0);
            i.set_param("distortionMode", 7.0);
            i.set_param("drive", 0.6);
            i
        }
    )
}

fn row_gluten() -> Row {
    effect_row!(
        "gluten",
        "Gluten (4:1, -24 dB, compressing)",
        "effect; no voice pool",
        {
            let mut i = daw_dsp::gluten::GlutenInstance::new(SAMPLE_RATE);
            i.set_param("threshold", -24.0);
            i.set_param("ratio", 4.0);
            i.set_param("attack", 5.0);
            i.set_param("release", 100.0);
            i.set_param("makeup", 3.0);
            i
        }
    )
}

fn row_proof() -> Row {
    effect_row!(
        "proof",
        "Proof (limiter engaged)",
        "effect; no voice pool",
        {
            let mut i = daw_dsp::proof::ProofInstance::new(SAMPLE_RATE);
            i.set_param("limiter_ceiling", -1.0);
            i.set_param("limiter_threshold", -12.0);
            i
        }
    )
}

/// Crust, the true-peak mastering limiter.
///
/// **This row did not exist, and the header claimed it could not.** It said
/// "Crust, Yeast and CvGate are absent because they have no Rust engine at
/// all" while `crates/daw-dsp/src/crust/` shipped a `#[wasm_bindgen]`
/// `CrustInstance` with a `process` export (`crust/mod.rs:22,32,69`). A
/// hand-written device list went stale against the crate it claims to
/// enumerate, which is the census failure ADR 0015 rule 2 names. The list is
/// now checked against the crate by `tests/quantum_bench_census.rs`.
///
/// Driven at the shipped defaults — `CrustEngine::new` sets `true_peak: true`
/// and `oversampling: 4` (`crust/engine.rs:258-259`), matching
/// `DEFAULT_CRUST_PATCH` (`CrustPatch.ts:78`), so the 4x oversampled
/// inter-sample peak detector is in the path exactly as it is in production.
///
/// `gain` is raised to 6 dB because the row has to be *limiting* to measure
/// anything. The shared excitation peaks near -2.1 dBFS and the shipped ceiling
/// is -0.3 dB, so at the default 0 dB input gain the limiter would never engage
/// and this row would time a gain stage. Same reason `row_proof` sets a -12 dB
/// threshold rather than trusting a default.
fn row_crust() -> Row {
    effect_row!(
        "crust",
        "Crust (true-peak limiting, 4x OS)",
        "effect; no voice pool; CrustPatch.ts:78 ships ceiling -0.3, truePeak, OS 4",
        {
            let mut i = daw_dsp::crust::CrustInstance::new(SAMPLE_RATE);
            i.set_param("gain", 6.0);
            i.set_param("ceiling", -0.3);
            i
        }
    )
}

fn row_knead() -> Row {
    effect_row!(
        "knead",
        "Knead (+4 semitones, PSOLA engaged)",
        "effect; no voice pool",
        {
            let mut i = daw_dsp::knead::KneadInstance::new(SAMPLE_RATE);
            // PSOLA is a passthrough at 0 semitones; shifting engages the
            // analysis/overlap-add path, which is the thing that costs.
            i.set_shift_semitones(4.0);
            i
        }
    )
}

/// Grinder at the model `GrinderPatch.ts:299` actually ships, `crunch-jcm`,
/// rather than at the `lead_jcm` the model sweep above happens to start from.
fn row_grinder() -> Row {
    // The shipped patch, all three values from `GrinderPatch.ts:299-301`:
    // `ampModel: 'crunch-jcm'`, `channel: 1`, `gain: 5`. An earlier version of
    // this row used channel 2 at gain 8.2 — the lead channel, three triode
    // stages instead of two — which measured a heavier circuit than the
    // reference project ever instantiates.
    let mut instance = GrinderInstance::new(SAMPLE_RATE);
    instance.set_param("ampModel", 1.0); // crunch-jcm
    instance.set_param("channel", 1.0); // shipped default, 2 triode stages
    instance.set_param("gain", 5.0); // shipped default
    instance.set_param("master", 8.0);
    instance.set_param("bass", 5.0);
    instance.set_param("mid", 5.0);
    instance.set_param("treble", 5.0);
    instance.set_param("fat", 0.0);
    let samples = sample_quanta(
        &mut instance,
        &mut |device, block| unsafe {
            fill_input(
                device.get_input_left_ptr(),
                device.get_input_right_ptr(),
                block,
            )
        },
        &mut |device| device.process(QUANTUM as u32),
    );
    let output_db = instance.get_output_db();
    Row {
        id: "grinder",
        label: "Grinder (Crunch JCM, ch 1, gain 5 — shipped patch)",
        load: "effect; the shipped patch, GrinderPatch.ts:299-301",
        distribution: summarise(samples),
        occupancy: format!("engine output {output_db:.2} dBFS"),
        occupancy_ok: output_db > -60.0,
    }
}

fn row_fermenter() -> Row {
    let struck = PRODUCTION_FERMENTER_VOICE_CEILING;
    let mut instance = fermenter_instance(struck);
    let samples = sample_quanta(&mut instance, &mut |_, _| {}, &mut |device| {
        device.process(QUANTUM as u32)
    });
    let active = instance.active_voices();
    Row {
        id: "fermenter",
        label: "Fermenter (32 sounding voices, 1 layer)",
        load: "fermenterProcessor.ts constructs an instance-wide ceiling of 32 voices",
        distribution: summarise(samples),
        occupancy: format!("active_voices() = {active}, expected {struck}"),
        occupancy_ok: active as usize == struck,
    }
}

/// Grand Boule with its 64 notes re-struck once a second.
///
/// Held indefinitely, a struck string runs out of energy: over the 53 s this
/// row is timed for, output RMS fell to 1e-9 and the figure became the cost of
/// 64 inaudible voices. `amplitude` — the release envelope the quality
/// demotion reads — stays pinned at 1.0 while the key is down, so the voices
/// never demote to a cheaper tier; they simply stop making sound while still
/// paying full price, which is the worst of both for a measurement. Re-striking
/// is what a pedalled piano does anyway.
fn row_grand_boule() -> Row {
    let mut instance = grand_boule_instance(GRAND_BOULE_POOL);
    let samples = sample_quanta(
        &mut instance,
        &mut |device, block| {
            if block % RESTRIKE_INTERVAL_QUANTA == 0 {
                for note in spread_notes(GRAND_BOULE_POOL) {
                    device.note_on(note, 0.8);
                }
            }
        },
        &mut |device| device.process(QUANTUM as u32),
    );
    let level = unsafe { rms_at(instance.process(QUANTUM as u32), instance.get_right_ptr()) };
    Row {
        id: "grand_boule",
        label: "Grand Boule (64 voices, re-struck 1/s)",
        load:
            "grandBouleEngineCore.ts:143 constructs 64; pedalled playing fills and holds the pool",
        distribution: summarise(samples),
        occupancy: format!("64 voices (no active-voice export), output RMS {level:.3e}"),
        occupancy_ok: level > 1.0e-5,
    }
}

/// Toaster with its 16 pads re-struck once a second.
///
/// A drum voice is a one-shot. Struck once and left, all 16 pads decayed to an
/// output of *exact zero* long before the timed run ended, and the row reported
/// the cost of sixteen idle voices. One strike per second is a slow drum
/// machine, not a fast one.
fn row_toaster() -> Row {
    let struck = 16_u8;
    let mut instance = daw_dsp::toaster::ToasterInstance::new(SAMPLE_RATE, u32::from(struck));
    instance.set_param("master_gain", 0.63);
    let samples = sample_quanta(
        &mut instance,
        &mut |device, block| {
            if block % RESTRIKE_INTERVAL_QUANTA == 0 {
                for pad in 0..16_u8 {
                    // Velocity is 0..127 here, not 0..1: the RT guard's 1.0
                    // drives the pads 45 dB under a real hit and still clears
                    // its non-silence check.
                    device.note_on(pad, 127.0, 36 + pad);
                }
            }
        },
        &mut |device| device.process(QUANTUM as u32),
    );
    let level = unsafe { rms_at(instance.process(QUANTUM as u32), instance.get_right_ptr()) };
    Row {
        id: "toaster",
        label: "Toaster (16 pads, re-struck 1/s)",
        load: "toasterProcessor.ts:215 constructs TOASTER_PAD_COUNT = 16",
        distribution: summarise(samples),
        occupancy: format!("16 pads (no active-voice export), output RMS {level:.3e}"),
        occupancy_ok: level > 1.0e-5,
    }
}

/// A one-second 220 Hz loop body, the sample Levain and Crumbs are driven with.
fn loop_sample(frames: u32) -> Vec<f32> {
    (0..frames)
        .map(|frame| (frame as f32 / SAMPLE_RATE * 220.0 * std::f32::consts::TAU).sin() * 0.8)
        .collect()
}

/// The instrument identity Levain ships defaulted to — `levainStore.ts:41`
/// builds `createDefaultPatch('violin-1')`. It is not decoration: see
/// `load_levain_bank` for what selecting it switches on.
const LEVAIN_INSTRUMENT_ID: &str = "violin-1";

/// Load a Levain bank **the way production loads one**, which is not the way
/// this bench used to.
///
/// `levainProcessor.ts:207,251,259` drives the staged-bank protocol —
/// `begin_sample_bank(instrumentId)` → `add_sample` → `add_zone` →
/// `build_zone_map` → `commit_sample_bank`. The bench previously skipped
/// `begin_sample_bank` and `commit_sample_bank` and wrote straight into the
/// live pool, which builds a zone map that sounds and therefore looked correct.
///
/// It was not correct, and the cost it printed was not Levain's.
/// `commit_sample_bank` is the **only** production path to
/// `RealismEngine::configure_for` (`levain/engine.rs:245`), and
/// `RealismEngine::new` leaves the instrument at `Instrument::Other`
/// (`levain/realism/mod.rs:204-213`), whose branch sets every realism amount to
/// `0.0` (`:249-253`). Every one of the five realism stages then early-returns
/// on `amount < 1e-4` — `body.rs:162`, `sympathetic.rs:89`, `bow_noise.rs:109`,
/// `breath_noise.rs:65`, `damping.rs:42`. So the old row rendered Levain with
/// its entire realism layer switched off and reported the result as Levain's
/// per-quantum cost.
///
/// `violin-1` is a bowed string, which is the expensive branch — body resonator
/// at 0.65, sympathetic bank at 0.5, bow noise at 0.5 and damping at 0.4
/// (`realism/mod.rs:236-241`) — and it is also the shipped default patch, so
/// this is the ordinary case rather than a chosen worst one.
///
/// This is exactly the shape the phase exists to catch: a harness that runs the
/// path under test, produces output, passes its own occupancy gate, and still
/// measures the wrong thing, because the costly branch is unreachable at the
/// default parameter value.
fn load_levain_bank(instance: &mut daw_dsp::levain::LevainInstance, frame_count: u32) {
    instance.begin_sample_bank(LEVAIN_INSTRUMENT_ID);
    let sample_id = instance
        .add_sample(loop_sample(frame_count), frame_count, 1, SAMPLE_RATE)
        .expect("staged bank is uniquely owned, so add_sample cannot return None here");
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
    assert!(
        instance.build_zone_map(1, 1),
        "Levain zone map failed to build; the row would measure the fallback tone engine"
    );
    assert!(
        instance.commit_sample_bank(),
        "Levain bank did not commit, so realism stays at Instrument::Other and every \
         realism stage early-returns — the row would understate the device"
    );
}

/// Levain at the polyphony it actually reaches, which is **not** the 64 voices
/// `levainProcessor.ts:155` constructs.
///
/// Legato ships enabled (`DEFAULT_LEGATO_CONFIG.enabled = true`,
/// `LevainPatch.ts:225`) and `LegatoEngine::note_on` returns `SyntheticGlide`
/// for a note within `MAX_LEGATO_INTERVAL` — 12 semitones,
/// `levain/types.rs:199` — of a held one, which *reuses* the held voice rather
/// than triggering the freshly allocated one. 64 notes spread across 88 keys
/// are ~1.4 semitones apart, so every other note glides and the pool settles at
/// 32.
///
/// Reported at the 32 it reaches, not at a 64 obtained by switching off a
/// shipped default. Same shape as the Fermenter finding: a constructed pool
/// size the device cannot fill.
fn row_levain() -> Row {
    let frame_count = 48_000_u32;
    let mut instance = daw_dsp::levain::LevainInstance::new(SAMPLE_RATE, 64);
    load_levain_bank(&mut instance, frame_count);
    for note in spread_notes(64) {
        instance.note_on(note, 100);
    }
    let samples = sample_quanta(&mut instance, &mut |_, _| {}, &mut |device| {
        device.process(QUANTUM as u32)
    });
    let active = instance.active_voices();
    Row {
        id: "levain",
        label: "Levain (32 sounding voices, looped zone)",
        load: "levainProcessor.ts:155 constructs 64 = MAX_VOICES_WASM; shipped legato collapses 64 note-ons to 32",
        distribution: summarise(samples),
        occupancy: format!("active_voices() = {active}, expected 32 from 64 note-ons"),
        occupancy_ok: active == 32,
    }
}

/// Crumbs with 32 held, looping voices.
///
/// The zone loops deliberately. A one-shot voice pitched 48 semitones above the
/// root plays a one-second sample in 62 ms and frees itself; unlooped, the pool
/// drained from 32 to 12 inside the warm-up and the row would have reported the
/// cost of a sampler two thirds idle.
fn row_crumbs() -> Row {
    let frame_count = 48_000_u32;
    let mut instance = daw_dsp::crumbs::CrumbsInstance::new(SAMPLE_RATE);
    let sample_id = instance.add_sample(loop_sample(frame_count), 1, SAMPLE_RATE as u32);
    instance.set_active_sample(sample_id);
    instance.set_param("loopMode", 1.0); // forward
    instance.set_param("loopStart", 0.0);
    instance.set_param("loopEnd", frame_count as f32);
    instance.set_param("sustain", 1.0);
    for note in spread_notes(32) {
        instance.note_on(note, 100);
    }
    let samples = sample_quanta(&mut instance, &mut |_, _| {}, &mut |device| {
        device.process(QUANTUM as u32)
    });
    let active = instance.active_voices();
    Row {
        id: "crumbs",
        label: "Crumbs (32 sounding voices, in-memory pool)",
        load: "crumbsProcessor.ts:106 takes no voice count; crate MAX_VOICES = 128",
        distribution: summarise(samples),
        occupancy: format!("active_voices() = {active}, expected 32"),
        occupancy_ok: active == 32,
    }
}

/// The reference project, defined here because **nothing in the repository
/// defines it**.
///
/// `SPEC-render-parity-instrumentation` AC-2 and `SPEC-browser-dsp-offload`
/// AC-002 both argue from "the reference project" and neither says what it
/// contains. Rather than quietly pick numbers, this is the composition every
/// total below is computed from, so a later reader can dispute the mix instead
/// of the arithmetic: a six-track session with an ordinary effect load.
///
/// Scoring is excluded — the tuner renders only while its surface is open.
/// ProofChamber's contribution is not in this native total, because it is not
/// in this crate; the wasm total in `quantum-cost-table.md` includes it.
const REFERENCE_PROJECT_AUDIO_THREAD: [(&str, usize); 8] = [
    // Four instrument tracks that render in a worklet.
    ("fermenter", 1),
    ("levain", 1),
    ("toaster", 1),
    ("crumbs", 1),
    // A guitar track, a tuned vocal, one creative send.
    ("grinder", 1),
    ("knead", 1),
    ("bacteria", 1),
    // The master bus.
    ("proof", 1),
];

/// Grand Boule is **not** in the audio-thread total, and that is the single
/// most important line in this file.
///
/// `GrandBouleNode.ts:480-518` branches on `ctx instanceof OfflineAudioContext`.
/// The live path builds `createWorkerRingTransport` — the engine runs in a
/// `Worker` and reaches the audio thread only as a consumer worklet copying out
/// of a `SharedArrayBuffer` ring. The inline-DSP worklet is the *offline* path,
/// and there is no fallback: without `SharedArrayBuffer` the live path calls
/// `requireSharedArrayBuffer('Grand Boule')` and throws before registering
/// anything.
///
/// So this figure is real and it is large, but it is not charged against the
/// 2.667 ms worklet deadline. An earlier version of this table summed it into
/// that budget and reported a headline that was wrong by more than every other
/// device combined. What the audio thread actually pays is measured by the
/// `grand_boule_ring_consumer` row in the wasm leg.
const REFERENCE_PROJECT_WORKER: [(&str, usize); 1] = [("grand_boule", 1)];

/// Instances of a device in the reference project that are *not* in the table
/// under their own id, kept separate so the table stays one row per device.
const REFERENCE_PROJECT_GLUTEN_INSTANCES: usize = 3;

fn percent_of_budget(nanoseconds: f64) -> f64 {
    (nanoseconds / BUDGET_NS) * 100.0
}

/// Print the whole native cost table. Registered as a criterion group entry
/// because that is how the existing verification passes in this file run; it
/// registers no benchmark of its own.
fn cost_table(_criterion: &mut Criterion) {
    let load_before = load_average();
    let floor = timer_floor();
    let rows = vec![
        row_bacteria(),
        row_bacteria_smudge(),
        row_gluten(),
        row_proof(),
        row_crust(),
        row_knead(),
        row_grinder(),
        row_fermenter(),
        row_grand_boule(),
        row_toaster(),
        row_levain(),
        row_crumbs(),
    ];

    let load_after = load_average();
    let describe_load = |load: Option<f64>| match load {
        Some(value) => format!("{value:.2}"),
        None => "unavailable".to_string(),
    };

    // Load is **recorded, not gated**. An earlier version refused to print on a
    // contended machine, which on this hardware meant refusing to print at all:
    // the desktop it runs on sustains a load average of 20-45 from ordinary
    // applications and never falls to an "idle" threshold.
    //
    // The way out is that contention is one-directional. It only ever adds time
    // to a sample, so the floor below is a genuine lower bound taken under load,
    // and the median is an upper bound on what a quiet machine would show. Both
    // are printed with the load they were taken at, so a later quiet run can be
    // compared rather than confused. Occupancy is still a hard gate — a row that
    // was not sounding measures nothing in either direction.
    let ceiling = load_ceiling();
    let busiest = [load_before, load_after]
        .into_iter()
        .flatten()
        .fold(0.0_f64, f64::max);
    let unverified: Vec<&str> = rows
        .iter()
        .filter(|row| !row.occupancy_ok)
        .map(|row| row.id)
        .collect();
    assert!(
        unverified.is_empty(),
        "these rows were not in the state they claim to measure, so their cost figures are \
         meaningless and no table is printed: {unverified:?}"
    );

    eprintln!("\n=== Per-quantum device cost — NATIVE ===\n");
    eprintln!(
        "budget {:.4} ms = 128 frames / 48 kHz; arch {}; {} warm-up quanta, {} timed quanta per row",
        BUDGET_NS / 1.0e6,
        std::env::consts::ARCH,
        TABLE_WARMUP_QUANTA,
        TABLE_SAMPLE_QUANTA
    );
    eprintln!(
        "1-minute load average {} before, {} after, on {} logical cores (recorded, not gated; \
         reference quiet threshold {:.1}, peak here {busiest:.2})",
        describe_load(load_before),
        describe_load(load_after),
        std::thread::available_parallelism().map_or(0, |cores| cores.get()),
        ceiling
    );
    eprintln!(
        "\nFLOOR is a LOWER bound and is valid under load; MEDIAN taken under load is an UPPER \n\
         bound on a quiet machine. Contention only ever adds time to a sample. Neither bounds the \n\
         deadline — that is AC-3's observation, not this one."
    );
    eprintln!(
        "\n{:<46} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9} {:>9} | {:>9} {:>8}",
        "device",
        "FLOOR",
        "min",
        "median",
        "MEAN",
        "p95",
        "p99",
        "p99.9",
        "max",
        "floor %",
        "mean %"
    );
    for row in &rows {
        let d = &row.distribution;
        let burst = if d.is_bursty() { " <- BURSTY" } else { "" };
        eprintln!(
            "{:<46} {:>8.1}us {:>8.1}us {:>8.1}us {:>8.1}us {:>8.1}us {:>8.1}us {:>8.1}us {:>8.1}us | {:>8.2}% {:>7.2}%{}",
            row.label,
            d.floor / 1000.0,
            d.min / 1000.0,
            d.median / 1000.0,
            d.mean / 1000.0,
            d.p95 / 1000.0,
            d.p99 / 1000.0,
            d.p999 / 1000.0,
            d.max / 1000.0,
            percent_of_budget(d.floor),
            percent_of_budget(d.mean),
            burst,
        );
    }
    let bursty: Vec<&str> = rows
        .iter()
        .filter(|row| row.distribution.is_bursty())
        .map(|row| row.id)
        .collect();
    if !bursty.is_empty() {
        eprintln!(
            "\nBURSTY rows do their work in blocks, so their MEDIAN is the cost of a quantum that \n\
             did nothing. Read MEAN for sustained load and p99/max for whether a single quantum \n\
             misses. Summing a bursty median into a thread total understates it: {bursty:?}"
        );
    }
    eprintln!(
        "{:<46} {:>8.3}us {:>8.3}us {:>8.3}us {:>8.3}us {:>8.3}us {:>8.3}us {:>8.3}us {:>8.3}us | {:>8.4}% {:>7.4}%",
        "(timer floor — Instant::now() twice)",
        floor.floor / 1000.0,
        floor.min / 1000.0,
        floor.median / 1000.0,
        floor.mean / 1000.0,
        floor.p95 / 1000.0,
        floor.p99 / 1000.0,
        floor.p999 / 1000.0,
        floor.max / 1000.0,
        percent_of_budget(floor.floor),
        percent_of_budget(floor.mean),
    );
    eprintln!(
        "\nThe far tail is not DSP cost. This bench thread runs at normal priority, not the \n\
         realtime priority a browser gives its audio thread, so a p99.9 or max in the tens of \n\
         milliseconds is the OS descheduling the thread mid-render. Read median through p99 as \n\
         the device; read the tail as an upper bound that includes the scheduler."
    );

    eprintln!(
        "\nper row: occupancy after the timed run, stationarity, and where the load comes from"
    );
    for row in &rows {
        let d = &row.distribution;
        let drift = (d.last_five_hundred_mean / d.first_five_hundred_mean - 1.0) * 100.0;
        eprintln!("  {}", row.id);
        eprintln!(
            "      occupancy: {} — {}",
            if row.occupancy_ok { "ok" } else { "FAILED" },
            row.occupancy
        );
        eprintln!("      load     : {}", row.load);
        eprintln!(
            "      drift    : first 500 {:.1}us -> last 500 {:.1}us ({drift:+.1}%), n = {}",
            d.first_five_hundred_mean / 1000.0,
            d.last_five_hundred_mean / 1000.0,
            d.n
        );
    }

    // -- the reference project ---------------------------------------------
    let lookup = |id: &str| -> &Distribution {
        &rows
            .iter()
            .find(|row| row.id == id)
            .unwrap_or_else(|| panic!("the reference project names {id}, which is not a table row"))
            .distribution
    };
    // Summed on the **mean**, not the median. A median total is only the
    // sustained cost if every row is flat, and `bacteria_smudge` is not — its
    // mean is ~7x its median. Using the median here would have charged a block
    // device at the price of its idle quantum. The floor stays a 1st-percentile
    // sum: it is a lower bound and does not claim to be a sustained figure.
    let mut audio_mean = 0.0;
    let mut audio_floor = 0.0;
    for (id, count) in REFERENCE_PROJECT_AUDIO_THREAD {
        audio_mean += lookup(id).mean * count as f64;
        audio_floor += lookup(id).floor * count as f64;
    }
    audio_mean += lookup("gluten").mean * REFERENCE_PROJECT_GLUTEN_INSTANCES as f64;
    audio_floor += lookup("gluten").floor * REFERENCE_PROJECT_GLUTEN_INSTANCES as f64;

    let mut worker_mean = 0.0;
    let mut worker_floor = 0.0;
    for (id, count) in REFERENCE_PROJECT_WORKER {
        worker_mean += lookup(id).mean * count as f64;
        worker_floor += lookup(id).floor * count as f64;
    }

    eprintln!(
        "\n=== Reference project (defined in this file — nothing in the repo defines it) ==="
    );
    eprintln!("  audio thread:");
    for (id, count) in REFERENCE_PROJECT_AUDIO_THREAD {
        eprintln!("    {count} x {id}");
    }
    eprintln!("    {REFERENCE_PROJECT_GLUTEN_INSTANCES} x gluten");
    eprintln!("  worker (not the audio thread):");
    for (id, count) in REFERENCE_PROJECT_WORKER {
        eprintln!("    {count} x {id}");
    }
    eprintln!("  (Scoring excluded: the tuner renders only while its surface is open.)");
    eprintln!(
        "  (ProofChamber and the Grand Boule ring consumer are wasm-leg rows; see the header.)"
    );
    eprintln!(
        "\n  AUDIO THREAD >= {:.3} ms ({:.1}% of the {:.4} ms budget)   lower bound, valid under load",
        audio_floor / 1.0e6,
        percent_of_budget(audio_floor),
        BUDGET_NS / 1.0e6
    );
    eprintln!(
        "  AUDIO THREAD <= {:.3} ms ({:.1}% of budget)   sustained (mean) upper bound, at load {busiest:.1}",
        audio_mean / 1.0e6,
        percent_of_budget(audio_mean)
    );
    eprintln!(
        "  WORKER line item, Grand Boule >= {:.3} ms ({:.1}%), <= {:.3} ms per quantum of audio, \
         on its own thread",
        worker_floor / 1.0e6,
        percent_of_budget(worker_floor),
        worker_mean / 1.0e6
    );
    eprintln!(
        "\n  Totals are summed on the MEAN, which is the amortised per-quantum cost and is the \
         \n  only summable statistic once any row is bursty. A median total charges a block device \
         \n  the price of the quantum in which it did nothing."
    );
    eprintln!(
        "\n  No summed p99 is reported. Knead's expensive mode is a duty cycle, not a tail — \
         \n  frame_size 2048 / 128 = one expensive quantum in 16 — so its p99 is a fact about where \
         \n  6.25% sits relative to 99%, not about the device. Summing every row's p99 would also \
         \n  assume every device spikes in the same quantum, which nothing makes true. The wasm leg \
         \n  reports period, tick cost and amortised mean instead."
    );
    eprintln!(
        "\n  Read against the wasm column, not this one. Native is a lower bound; production runs \
         wasm in a worklet."
    );
}

// ---------------------------------------------------------------------------
// Criterion coverage for the devices the original file did not reach
// ---------------------------------------------------------------------------

/// An independent statistical read on the same devices the cost table above
/// times by hand. Two estimators disagreeing is the signal worth having; the
/// table is the artifact, criterion is the cross-check.
fn bench_remaining_devices(criterion: &mut Criterion) {
    let mut group = criterion.benchmark_group("device/instance_process_128");
    group.measurement_time(Duration::from_secs(3));

    macro_rules! bench_effect {
        ($name:expr, $instance:expr) => {{
            let mut instance = $instance;
            let (left_in, right_in) = (
                instance.get_input_left_ptr(),
                instance.get_input_right_ptr(),
            );
            let mut block = 0_usize;
            for warm in 0..WARMUP_BLOCKS {
                unsafe { fill_input(left_in, right_in, warm) };
                instance.process(QUANTUM as u32);
            }
            group.bench_function(BenchmarkId::from_parameter($name), |bencher| {
                bencher.iter(|| {
                    unsafe { fill_input(left_in, right_in, block) };
                    block += 1;
                    black_box(instance.process(black_box(QUANTUM as u32)))
                });
            });
        }};
    }

    bench_effect!("bacteria", {
        let mut i = daw_dsp::bacteria::BacteriaInstance::new(SAMPLE_RATE);
        i.set_param("bandCount", 3.0);
        i.set_param("mix", 1.0);
        i
    });
    bench_effect!("gluten", {
        let mut i = daw_dsp::gluten::GlutenInstance::new(SAMPLE_RATE);
        i.set_param("threshold", -24.0);
        i.set_param("ratio", 4.0);
        i.set_param("attack", 5.0);
        i.set_param("release", 100.0);
        i.set_param("makeup", 3.0);
        i
    });
    bench_effect!("proof", {
        let mut i = daw_dsp::proof::ProofInstance::new(SAMPLE_RATE);
        i.set_param("limiter_ceiling", -1.0);
        i.set_param("limiter_threshold", -12.0);
        i
    });
    bench_effect!("knead", {
        let mut i = daw_dsp::knead::KneadInstance::new(SAMPLE_RATE);
        i.set_shift_semitones(4.0);
        i
    });

    let mut toaster = daw_dsp::toaster::ToasterInstance::new(SAMPLE_RATE, 16);
    toaster.set_param("master_gain", 0.63);
    for pad in 0..16_u8 {
        toaster.note_on(pad, 127.0, 36 + pad);
    }
    for _ in 0..WARMUP_BLOCKS {
        toaster.process(QUANTUM as u32);
    }
    group.bench_function(BenchmarkId::from_parameter("toaster"), |bencher| {
        bencher.iter(|| black_box(toaster.process(black_box(QUANTUM as u32))));
    });

    let frame_count = 48_000_u32;
    let mut levain = daw_dsp::levain::LevainInstance::new(SAMPLE_RATE, 64);
    load_levain_bank(&mut levain, frame_count);
    for note in spread_notes(64) {
        levain.note_on(note, 100);
    }
    for _ in 0..WARMUP_BLOCKS {
        levain.process(QUANTUM as u32);
    }
    group.bench_function(BenchmarkId::from_parameter("levain"), |bencher| {
        bencher.iter(|| black_box(levain.process(black_box(QUANTUM as u32))));
    });

    let mut crumbs = daw_dsp::crumbs::CrumbsInstance::new(SAMPLE_RATE);
    let crumbs_sample = crumbs.add_sample(loop_sample(frame_count), 1, SAMPLE_RATE as u32);
    crumbs.set_active_sample(crumbs_sample);
    crumbs.set_param("loopMode", 1.0);
    crumbs.set_param("loopStart", 0.0);
    crumbs.set_param("loopEnd", frame_count as f32);
    crumbs.set_param("sustain", 1.0);
    for note in spread_notes(32) {
        crumbs.note_on(note, 100);
    }
    for _ in 0..WARMUP_BLOCKS {
        crumbs.process(QUANTUM as u32);
    }
    group.bench_function(BenchmarkId::from_parameter("crumbs"), |bencher| {
        bencher.iter(|| black_box(crumbs.process(black_box(QUANTUM as u32))));
    });

    group.finish();
}

criterion_group!(
    benches,
    cost_table,
    bench_grand_boule_process_block,
    bench_grand_boule_instance,
    bench_grand_boule_saturated_steal,
    bench_fermenter_instance,
    bench_grinder_instance,
    bench_remaining_devices,
);
criterion_main!(benches);
