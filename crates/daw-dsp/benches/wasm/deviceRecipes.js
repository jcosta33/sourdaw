/**
 * How each device is driven for the wasm leg of the per-quantum cost table.
 *
 * Every recipe here is the wasm mirror of the native setup in
 * `benches/quantum.rs`, so a row's native and wasm columns describe the same
 * device in the same state. Two rules the recipes obey, both learned the hard
 * way and both recorded in that file's header:
 *
 * * **Sounding, not allocated.** Almost every engine in this crate early-returns
 *   on an idle voice or a bypassed stage, so an instance that has merely been
 *   constructed benchmarks the `if` that skips the DSP. Each recipe drives its
 *   device into an audibly active state and the harness verifies it in-run
 *   (`active_voices()` where the device exports one, output RMS otherwise) —
 *   see `verify` below.
 * * **The polyphony production constructs, not the crate default.** Grand Boule
 *   is 64 because `grandBouleEngineCore.ts` builds it with 64, against a crate
 *   `DEFAULT_VOICE_COUNT` of 32. That distinction was the whole finding of the
 *   original bench, so every load-bearing count here cites its production call
 *   site.
 */

export const SAMPLE_RATE = 48_000;
export const QUANTUM = 128;

/** 128 frames at 48 kHz, in milliseconds. */
export const BUDGET_MS = (QUANTUM / SAMPLE_RATE) * 1000;

/**
 * Every row of the table, in the order it is measured. The page renders one
 * `OfflineAudioContext` per entry.
 *
 * Crust, Yeast and CvGate are absent because they have no Rust engine at all —
 * see the device-naming key in the repository `AGENTS.md`. Their cost is
 * JavaScript on the main thread or in a plain node graph, which this instrument
 * does not measure and does not claim to.
 */
export const DEVICE_IDS = [
    'bacteria',
    'gluten',
    'proof',
    'knead',
    'grinder',
    'fermenter',
    'grand_boule',
    'toaster',
    'levain',
    'crumbs',
    'proof_chamber_plate',
    'proof_chamber_fdn16',
    'scoring',
];

/**
 * The deterministic excitation `tests/engine_output_level.rs` uses, so an
 * effect sees the same signal natively and in wasm: a 110 Hz fundamental with
 * two harmonics and a decaying pick transient every 4800 frames, fixed by frame
 * index. The transient matters — gates, compressors, sag and envelope followers
 * all take different branches on a steady tone than on a struck one.
 */
export function excitation(frame) {
    const t = frame / SAMPLE_RATE;
    const fundamental = Math.sin(t * 110 * Math.PI * 2);
    const second = Math.sin(t * 220 * Math.PI * 2) * 0.5;
    const third = Math.sin(t * 440 * Math.PI * 2) * 0.25;
    const phase = (frame % 4800) / SAMPLE_RATE;
    const pick = Math.exp(-phase * 60) * 0.6;
    const body = (fundamental + second + third) * 0.28;
    return [body * (1 + pick), body * (1 + pick * 0.8)];
}

/** `count` distinct MIDI notes spread across A0..C8, matching `spread_notes` in the Rust bench. */
export function spreadNotes(count) {
    const notes = [];
    for (let index = 0; index < count; index += 1) {
        notes.push(21 + Math.floor((index * 87) / Math.max(count, 1)));
    }
    return notes;
}

/**
 * Quanta between re-strikes for a device whose voices decay. 375 is one second
 * of audio.
 *
 * Two rows need it, and both are findings in their own right: over the 53 s a
 * row is timed for, a struck Grand Boule voice decays to an output RMS of 1e-9
 * and 16 struck Toaster pads decay to *exact zero*. Held-and-forgotten, they
 * report the cost of an instrument that has stopped making sound — precisely
 * the trap the bench header warns about. Re-striking is also what the devices
 * are for: a pedalled piano and a drum machine both retrigger constantly.
 */
export const RESTRIKE_INTERVAL_QUANTA = 375;

/** A one-second 220 Hz loop, the sample body Levain and Crumbs are driven with. */
export function loopSample(frames) {
    const data = new Float32Array(frames);
    for (let f = 0; f < frames; f += 1) {
        data[f] = Math.sin((f / SAMPLE_RATE) * 220 * Math.PI * 2) * 0.8;
    }
    return data;
}

/**
 * Build the device table.
 *
 * `dsp`, `chamber` and `scoring` are the three initialised wasm module
 * namespaces. Each recipe returns:
 *
 * - `render(frame)` — one quantum, and *only* the work production's render path
 *   does. Input marshalling for pointer-input effects is hoisted into
 *   `feed(frame)`, which the harness calls outside the timed region, because a
 *   worklet pays that copy against `inputs[0]` regardless of which device
 *   consumes it. For `ProofChamberInstance`/`ScoringInstance` the copy is inside
 *   `process` by construction — their exports take `&[f32]` — so their figures
 *   include it, exactly as production does.
 * - `feed(frame)` — optional, untimed input marshalling.
 * - `verify()` — `{ ok, detail }`, evaluated after warm-up and again after the
 *   timed run, so a device that fell silent halfway through cannot be reported.
 * - `note` — what the load parameter is and where production sets it.
 */
export function buildDevices({ dsp, chamber, scoring, only }) {
    const devices = [];
    /**
     * Constructing a device allocates: Levain and Crumbs each load a one-second
     * sample, Grand Boule builds 64 physical-model voices. When the worklet is
     * measuring one row it builds only that row, so an unrelated device's setup
     * cost and heap residency never land in someone else's figure.
     */
    const wanted = (id) => only === undefined || only === id;

    const memoryView = (module, ptr, length) => new Float32Array(module.memory.buffer, ptr, length);

    /** RMS over the two output channels a pointer-returning export just wrote. */
    const pointerRms = (module, leftPtr, rightPtr) => {
        const left = memoryView(module, leftPtr, QUANTUM);
        const right = memoryView(module, rightPtr, QUANTUM);
        let sum = 0;
        for (let i = 0; i < QUANTUM; i += 1) {
            sum += left[i] * left[i] + right[i] * right[i];
        }
        return Math.sqrt(sum / (2 * QUANTUM));
    };

    /** An effect whose input arrives through raw wasm pointers. */
    const pointerEffect = ({ id, label, note, instance, module }) => {
        const inLeft = instance.get_input_left_ptr();
        const inRight = instance.get_input_right_ptr();
        let lastLeftPtr = 0;
        return {
            id,
            label,
            note,
            feed(frame) {
                const left = memoryView(module, inLeft, QUANTUM);
                const right = memoryView(module, inRight, QUANTUM);
                for (let i = 0; i < QUANTUM; i += 1) {
                    const [l, r] = excitation(frame * QUANTUM + i);
                    left[i] = l;
                    right[i] = r;
                }
            },
            render() {
                lastLeftPtr = instance.process(QUANTUM);
                return lastLeftPtr;
            },
            verify() {
                const level = pointerRms(module, lastLeftPtr, instance.get_right_ptr());
                return {
                    ok: level > 1e-5,
                    detail: `output RMS ${level.toExponential(3)}`,
                };
            },
        };
    };

    /**
     * An instrument whose voices are struck once and never released.
     *
     * `struck` is how many note-ons were sent; `expectSounding` is how many
     * voices must actually be ringing for the figure to mean anything. They are
     * separate because for two devices they differ, and the difference is a
     * finding rather than a setup bug — see the Fermenter and Levain recipes.
     * `verify` is run twice, after warm-up and after the timed run, so a pool
     * that drains mid-run cannot be reported as a steady-state cost.
     */
    const heldInstrument = ({ id, label, note, instance, module, struck, expectSounding, activeVoices, restrike }) => {
        let lastLeftPtr = 0;
        return {
            id,
            label,
            note,
            feed:
                restrike === undefined
                    ? undefined
                    : (frame) => {
                          if (frame % RESTRIKE_INTERVAL_QUANTA === 0) {
                              restrike();
                          }
                      },
            render() {
                lastLeftPtr = instance.process(QUANTUM);
                return lastLeftPtr;
            },
            verify() {
                const level = pointerRms(module, lastLeftPtr, instance.get_right_ptr());
                if (activeVoices === undefined) {
                    return {
                        ok: level > 1e-5,
                        detail: `${struck} notes (no active-voice export), output RMS ${level.toExponential(3)}`,
                    };
                }
                const active = activeVoices();
                return {
                    ok: active === expectSounding && level > 1e-5,
                    detail: `active_voices() = ${active}, expected ${expectSounding} from ${struck} note-ons, output RMS ${level.toExponential(3)}`,
                };
            },
        };
    };

    // -- Bacteria — multiband creative FX ----------------------------------
    if (wanted('bacteria')) {
        const instance = new dsp.BacteriaInstance(SAMPLE_RATE);
        instance.set_param('bandCount', 3);
        instance.set_param('mix', 1);
        devices.push(
            pointerEffect({
                id: 'bacteria',
                label: 'Bacteria (3 bands, mix 1.0)',
                note: 'effect; no voice pool',
                instance,
                module: dsp,
            })
        );
    }

    // -- Gluten — bus compressor -------------------------------------------
    if (wanted('gluten')) {
        const instance = new dsp.GlutenInstance(SAMPLE_RATE);
        instance.set_param('threshold', -24);
        instance.set_param('ratio', 4);
        instance.set_param('attack', 5);
        instance.set_param('release', 100);
        instance.set_param('makeup', 3);
        devices.push(
            pointerEffect({
                id: 'gluten',
                label: 'Gluten (4:1, -24 dB, compressing)',
                note: 'effect; no voice pool',
                instance,
                module: dsp,
            })
        );
    }

    // -- Proof — mastering suite -------------------------------------------
    if (wanted('proof')) {
        const instance = new dsp.ProofInstance(SAMPLE_RATE);
        instance.set_param('limiter_ceiling', -1);
        instance.set_param('limiter_threshold', -12);
        devices.push(
            pointerEffect({
                id: 'proof',
                label: 'Proof (limiter engaged)',
                note: 'effect; no voice pool',
                instance,
                module: dsp,
            })
        );
    }

    // -- Knead — real-time pitch correction --------------------------------
    if (wanted('knead')) {
        const instance = new dsp.KneadInstance(SAMPLE_RATE);
        // PSOLA is a passthrough at 0 semitones; shifting engages the
        // analysis/overlap-add path, which is the thing that costs.
        instance.set_shift_semitones(4);
        devices.push(
            pointerEffect({
                id: 'knead',
                label: 'Knead (+4 semitones, PSOLA engaged)',
                note: 'effect; no voice pool',
                instance,
                module: dsp,
            })
        );
    }

    // -- Grinder — guitar amp/pedal sim ------------------------------------
    // `GrinderPatch.ts:299` ships `ampModel: 'crunch-jcm'`, so that is the row.
    if (wanted('grinder')) {
        const instance = new dsp.GrinderInstance(SAMPLE_RATE);
        instance.set_param('ampModel', 1); // crunch-jcm — the shipped default patch
        instance.set_param('channel', 2);
        instance.set_param('gain', 8.2);
        instance.set_param('master', 8);
        instance.set_param('bass', 5);
        instance.set_param('mid', 5);
        instance.set_param('treble', 5);
        instance.set_param('fat', 0);
        const device = pointerEffect({
            id: 'grinder',
            label: 'Grinder (Crunch JCM, lead ch, gain 8.2)',
            note: "effect; ampModel from GrinderPatch.ts:299 default 'crunch-jcm'",
            instance,
            module: dsp,
        });
        device.verify = () => {
            const outputDb = instance.get_output_db();
            return { ok: outputDb > -60, detail: `engine output ${outputDb.toFixed(2)} dBFS` };
        };
        devices.push(device);
    }

    // -- Fermenter — flagship hybrid synth ---------------------------------
    // `fermenterProcessor.ts:164` asks for 32 voices and does not get them:
    // `MasterSynth::new` discards the argument and a layer's pool is a fixed
    // 16, so one layer — the shipped patch — tops out at 16 sounding voices.
    if (wanted('fermenter')) {
        const struck = 16;
        const instance = new dsp.FermenterInstance(SAMPLE_RATE, 32);
        instance.set_param('cutoff', 4000);
        instance.set_param('resonance', 0.4);
        for (const note of spreadNotes(struck)) {
            instance.note_on(note, 100);
        }
        devices.push(
            heldInstrument({
                id: 'fermenter',
                label: 'Fermenter (16 sounding voices, 1 layer)',
                note: 'fermenterProcessor.ts:164 constructs 32; one layer can hold 16, which is production',
                instance,
                module: dsp,
                struck,
                expectSounding: 16,
                activeVoices: () => instance.active_voices(),
            })
        );
    }

    // -- Grand Boule — physical-model grand piano --------------------------
    // `grandBouleEngineCore.ts:143` builds 64, not the crate's 32.
    if (wanted('grand_boule')) {
        const struck = 64;
        const notes = spreadNotes(struck);
        const instance = new dsp.GrandBouleInstance(SAMPLE_RATE, 64);
        const strike = () => {
            for (const note of notes) {
                instance.note_on(note, 0.8);
            }
        };
        strike();
        devices.push(
            heldInstrument({
                id: 'grand_boule',
                label: 'Grand Boule (64 voices, re-struck 1/s)',
                note: 'grandBouleEngineCore.ts:143 constructs 64; pedalled playing fills the pool and holds it',
                instance,
                module: dsp,
                struck,
                restrike: strike,
            })
        );
    }

    // -- Toaster — drum machine --------------------------------------------
    // `toasterProcessor.ts:191` constructs `TOASTER_PAD_COUNT` = 16 pads.
    if (wanted('toaster')) {
        const struck = 16;
        const instance = new dsp.ToasterInstance(SAMPLE_RATE, 16);
        instance.set_param('master_gain', 0.63);
        const strike = () => {
            for (let pad = 0; pad < struck; pad += 1) {
                // Velocity is 0..127 here, not 0..1: the RT guard's 1.0 drives
                // the pads 45 dB under a real hit and still clears its
                // non-silence check.
                instance.note_on(pad, 127, 36 + pad);
            }
        };
        strike();
        devices.push(
            heldInstrument({
                id: 'toaster',
                label: 'Toaster (16 pads, re-struck 1/s)',
                note: 'toasterProcessor.ts:191 constructs TOASTER_PAD_COUNT = 16',
                instance,
                module: dsp,
                struck,
                restrike: strike,
            })
        );
    }

    // -- Levain — orchestral sample instrument ------------------------------
    //
    // `levainProcessor.ts:149` constructs 64 voices, which is also
    // `MAX_VOICES_WASM`. **64 note-ons do not produce 64 voices.** Legato is on
    // by default (`DEFAULT_LEGATO_CONFIG.enabled = true`,
    // `LevainPatch.ts:225`), and `LegatoEngine::note_on` returns
    // `SyntheticGlide` for any note within `MAX_LEGATO_INTERVAL` (12 semitones,
    // `levain/types.rs:199`) of a held one, which *reuses* the held voice
    // instead of triggering the allocated one. 64 notes spread across the 88-key
    // range are ~1.4 semitones apart, so every other one glides: the pool
    // settles at 32 and stays there.
    //
    // The row is reported at the 32 it reaches rather than at a 64 obtained by
    // switching off a shipped default. This is the same shape as the Fermenter
    // finding — a constructed pool size that the device cannot actually fill —
    // and the assertion below is what would catch it changing.
    if (wanted('levain')) {
        const struck = 64;
        const frameCount = 48_000;
        const instance = new dsp.LevainInstance(SAMPLE_RATE, 64);
        const sampleId = instance.add_sample(loopSample(frameCount), frameCount, 1, SAMPLE_RATE);
        instance.add_zone(
            0, sampleId, 0, 69, 0, 127, 0, 127, 0, 1, 0, false, 1, 0, frameCount, 0, 0.0, 0.005, 0.1, 1.0, 0.3
        );
        instance.build_zone_map(1, 1);
        for (const note of spreadNotes(struck)) {
            instance.note_on(note, 100);
        }
        devices.push(
            heldInstrument({
                id: 'levain',
                label: 'Levain (32 sounding voices, looped zone)',
                note: 'levainProcessor.ts:149 constructs 64 = MAX_VOICES_WASM; shipped legato collapses 64 note-ons to 32 voices',
                instance,
                module: dsp,
                struck,
                expectSounding: 32,
                activeVoices: () => instance.active_voices(),
            })
        );
    }

    // -- Crumbs — sampler/slicer -------------------------------------------
    //
    // `crumbsProcessor.ts:100` takes no voice argument; the pool is the crate's
    // `MAX_VOICES` = 128. 32 held notes is a heavy but reachable slice load.
    // The wasm build renders from the in-memory pool `add_sample` fills, since
    // an `AudioWorkletGlobalScope` has no file API for the streaming path.
    //
    // The zone loops deliberately. A one-shot voice pitched 48 semitones above
    // the root plays a one-second sample in 62 ms and frees itself, so an
    // unlooped setup drained from 32 voices to 12 inside the *warm-up* and then
    // reported the cost of a sampler with two thirds of its pool idle. Looping
    // is what a held sustain does, and it is what makes the timed region
    // stationary.
    if (wanted('crumbs')) {
        const struck = 32;
        const frameCount = 48_000;
        const instance = new dsp.CrumbsInstance(SAMPLE_RATE);
        const sampleId = instance.add_sample(loopSample(frameCount), 1, SAMPLE_RATE);
        instance.set_active_sample(sampleId);
        instance.set_param('loopMode', 1); // forward
        instance.set_param('loopStart', 0);
        instance.set_param('loopEnd', frameCount);
        instance.set_param('sustain', 1);
        for (const note of spreadNotes(struck)) {
            instance.note_on(note, 100);
        }
        devices.push(
            heldInstrument({
                id: 'crumbs',
                label: 'Crumbs (32 sounding voices, in-memory pool)',
                note: 'crumbsProcessor.ts:100 takes no voice count; crate MAX_VOICES = 128',
                instance,
                module: dsp,
                struck,
                expectSounding: 32,
                activeVoices: () => instance.active_voices(),
            })
        );
    }

    // -- ProofChamber — algorithmic reverb ("Dutch Oven") -------------------
    // A sibling crate, and a slice-input export: `process(left, right, frames)`
    // copies through the wasm-bindgen glue, so that copy is inside the figure.
    // Two rows, because the algorithm is a user-selected cost: `plate` is the
    // shipped default (`ProofChamberState.ts:30`) and `fdn-16` is the most
    // expensive one a user can actually reach.
    for (const [id, algorithm, label] of [
        ['proof_chamber_plate', 0, 'ProofChamber (Plate — shipped default)'],
        ['proof_chamber_fdn16', 2, 'ProofChamber (FDN-16 — heaviest selectable)'],
    ]) {
        if (!wanted(id)) {
            continue;
        }
        const instance = new chamber.ProofChamberInstance(SAMPLE_RATE);
        instance.set_param('algorithm', algorithm);
        instance.set_param('mix', 0.4);
        instance.set_param('decay', 0.6);
        const left = new Float32Array(QUANTUM);
        const right = new Float32Array(QUANTUM);
        let lastLeftPtr = 0;
        devices.push({
            id,
            label,
            note: 'effect; slice-input export, so the JS→wasm input copy is inside the figure',
            feed(frame) {
                for (let i = 0; i < QUANTUM; i += 1) {
                    const [l, r] = excitation(frame * QUANTUM + i);
                    left[i] = l;
                    right[i] = r;
                }
            },
            render() {
                lastLeftPtr = instance.process(left, right, QUANTUM);
                return lastLeftPtr;
            },
            verify() {
                const level = pointerRms(chamber, lastLeftPtr, instance.get_right_ptr());
                return { ok: level > 1e-5, detail: `output RMS ${level.toExponential(3)}` };
            },
        });
    }

    // -- Scoring — the tuner ------------------------------------------------
    // Also a slice-input export. Not a mix device: it only runs while the tuner
    // surface is open, which is why it is excluded from the reference project.
    if (wanted('scoring')) {
        const instance = new scoring.ScoringInstance(SAMPLE_RATE);
        const left = new Float32Array(QUANTUM);
        const right = new Float32Array(QUANTUM);
        let lastLeftPtr = 0;
        devices.push({
            id: 'scoring',
            label: 'Scoring / Tuner (pitch detection running)',
            note: 'analysis; runs only while the tuner is open, so not in the reference project',
            feed(frame) {
                for (let i = 0; i < QUANTUM; i += 1) {
                    const [l, r] = excitation(frame * QUANTUM + i);
                    left[i] = l;
                    right[i] = r;
                }
            },
            render() {
                lastLeftPtr = instance.process(left, right, QUANTUM);
                return lastLeftPtr;
            },
            verify() {
                const level = pointerRms(scoring, lastLeftPtr, instance.get_right_ptr());
                const detected = instance.get_frequency();
                return {
                    ok: level > 1e-5 && detected > 0,
                    detail: `output RMS ${level.toExponential(3)}, detected ${detected.toFixed(1)} Hz (stimulus fundamental 110 Hz)`,
                };
            },
        });
    }

    return devices;
}
