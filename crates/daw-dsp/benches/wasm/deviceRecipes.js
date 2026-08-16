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
 * Yeast and CvGate are absent because they have no Rust engine at all — see the
 * device-naming key in the repository `AGENTS.md`. Their cost is JavaScript on
 * the main thread or in a plain node graph, which this instrument does not
 * measure and does not claim to.
 *
 * **Crust was listed on those grounds and should not have been.** It has a
 * `#[wasm_bindgen]` `CrustInstance` with a `process` export
 * (`crust/mod.rs:22,32,69`), and the committed `daw_dsp_bg.wasm` exports it, so
 * this leg could always have measured it. A hand-written list went stale
 * against the crate it claims to enumerate; `tests/quantum_bench_census.rs`
 * now derives the population from the crate source and compares it against the
 * native bench, so the next such gap fails a test.
 */
export const DEVICE_IDS = [
    'bacteria',
    'bacteria_smudge',
    'crust',
    'gluten',
    'proof',
    'knead',
    'grinder',
    'fermenter',
    'fermenter_automation_16',
    'fermenter_automation_90',
    'fermenter_automation_105',
    'fermenter_automation_1050',
    'grand_boule',
    'grand_boule_ring_consumer',
    'toaster',
    'levain',
    'crumbs',
    'proof_chamber_plate',
    'proof_chamber_fdn16',
    'scoring',
];

/**
 * Where a row's cost is actually charged.
 *
 * This is the distinction the first version of this table got wrong, and it
 * changed the headline. `GrandBouleNode.ts:480-518` branches on
 * `ctx instanceof OfflineAudioContext`: the **live** path builds
 * `createWorkerRingTransport` — engine in a `Worker`, samples across a
 * `SharedArrayBuffer` ring — and the only thing it registers on the audio
 * thread is a consumer worklet that copies from that ring. The inline-DSP
 * worklet is the **offline** path. There is no fallback: without
 * `SharedArrayBuffer` the live path calls `requireSharedArrayBuffer('Grand
 * Boule')` and *throws* before any module registration.
 *
 * So Grand Boule's DSP cost cannot land on the audio thread during playback,
 * and summing it into an audio-thread budget overstates that budget by more
 * than everything else combined. It is charged to `worker` and reported as its
 * own line; what the audio thread actually pays for Grand Boule is the
 * `grand_boule_ring_consumer` row.
 *
 * `offline` marks a figure that exists only in an `OfflineAudioContext` render
 * — bounce and export, where there is no deadline at all.
 */
export const COST_SITE = {
    bacteria: 'audio-thread',
    bacteria_smudge: 'audio-thread',
    crust: 'audio-thread',
    gluten: 'audio-thread',
    proof: 'audio-thread',
    knead: 'audio-thread',
    grinder: 'audio-thread',
    fermenter: 'audio-thread',
    fermenter_automation_16: 'audio-thread',
    fermenter_automation_90: 'audio-thread',
    fermenter_automation_105: 'audio-thread',
    fermenter_automation_1050: 'audio-thread',
    grand_boule: 'worker',
    grand_boule_ring_consumer: 'audio-thread',
    toaster: 'audio-thread',
    levain: 'audio-thread',
    crumbs: 'audio-thread',
    proof_chamber_plate: 'audio-thread',
    proof_chamber_fdn16: 'audio-thread',
    scoring: 'audio-thread',
};

/**
 * Devices whose expensive work fires on a fixed period rather than every
 * quantum, with the period in quanta and where it comes from.
 *
 * These are **duty cycles, not tails**, and reading their p95/p99 as a tail is
 * a category error. Knead buffers to `yin_cfg.frame_size` = 2048 frames before
 * running an analysis, which at 128 frames per quantum is one expensive quantum
 * in 16 — 6.25%, forced unconditionally whenever `shift_semitones != 0`.
 * Scoring analyses every `hop = sample_rate / 30` = 1600 frames, which is 12.5
 * quanta, so two expensive quanta in every 25 — 8.0%.
 *
 * Both straddle the 5% line, which is why p95 and p99 land in the expensive
 * mode *by construction*. Had `frame_size` been 4096, Knead's p95 would read
 * ~0.5 us instead of ~1000 us with no change whatever to the device. The
 * meaningful figures are the period, the tick cost and the amortised mean, and
 * the runner reports those three instead of pretending the p95 is a tail.
 */
export const DUTY_CYCLE = {
    knead: { periodQuanta: 16, source: 'yin_cfg.frame_size = 2048 frames / 128 = 16 quanta' },
    scoring: { periodQuanta: 12.5, source: 'hop = sample_rate / 30 = 1600 frames / 128 = 12.5 quanta' },
    // The heaviest duty cycle here, and the only one above the 5% line by a
    // wide margin. `SmudgeProcessor` runs a 2048-point FFT at 75% overlap
    // (`bacteria/stft.rs:11-12,164`), so its hop is 2048/4 = 512 frames = 4
    // quanta — one expensive quantum in every four, 25%, on each of the three
    // bands. Its median is therefore the cost of a quantum that only filled the
    // window and carries no information about the device; read its mean.
    bacteria_smudge: {
        periodQuanta: 4,
        source: 'stft.rs:11-12,164 — fft 2048, hop = fft/4 = 512 frames / 128 = 4 quanta',
    },
};

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
export function buildDevices({ dsp, chamber, scoring, ring, readBlockAcquire, only, quantaBudget }) {
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
    const heldInstrument = ({
        id,
        label,
        note,
        instance,
        module,
        struck,
        expectSounding,
        activeVoices,
        restrike,
        soloReference,
    }) => {
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
                          soloReference?.feed(frame);
                      },
            render() {
                lastLeftPtr = instance.process(QUANTUM);
                return lastLeftPtr;
            },
            verify() {
                const level = pointerRms(module, lastLeftPtr, instance.get_right_ptr());
                if (activeVoices !== undefined) {
                    const active = activeVoices();
                    return {
                        ok: active === expectSounding && level > 1e-5,
                        detail: `active_voices() = ${active}, expected ${expectSounding} from ${struck} note-ons, output RMS ${level.toExponential(3)}`,
                    };
                }

                // No `active_voices()` export on this engine, so occupancy is
                // established by **level scaling against a solo reference**
                // rather than by a bare non-silence threshold.
                //
                // The bare threshold was the hole: `level > 1e-5` is cleared by
                // *one* sounding voice out of 64, so the guard the table
                // advertised could not tell a full pool from a single note.
                // Independent voices at different pitches sum incoherently, so
                // total RMS grows as sqrt(N). This renders one identically
                // driven voice alongside and asserts the N-voice output sits in
                // a two-sided band around sqrt(N) x the solo level: the lower
                // bound reds when voices are missing, the upper bound reds when
                // something is summing coherently or running away.
                //
                // The band is wide (0.45x to 2.2x) because voices differ in
                // pitch and therefore in energy. It is still ~4x tighter than
                // the gap between 64 voices and 1, which is the failure it
                // exists to catch.
                const solo = soloReference.rms();
                const expectedRatio = Math.sqrt(struck);
                const ratio = solo > 0 ? level / solo : 0;
                const low = 0.45 * expectedRatio;
                const high = 2.2 * expectedRatio;
                return {
                    ok: level > 1e-5 && ratio >= low && ratio <= high,
                    detail:
                        `${struck} notes, no active-voice export: output RMS ${level.toExponential(3)} is ` +
                        `${ratio.toFixed(1)}x one identically-driven voice (${solo.toExponential(3)}), ` +
                        `band ${low.toFixed(1)}-${high.toFixed(1)}x around sqrt(${struck}) = ${expectedRatio.toFixed(1)}x`,
                };
            },
        };
    };

    /**
     * One voice of the same device, driven identically, rendered alongside the
     * measured instance so occupancy can be checked as a *ratio*. Outside every
     * timed region — `feed` and `rms` are only ever called from the untimed
     * paths.
     */
    const makeSoloReference = ({ instance, module, strike }) => {
        strike();
        return {
            feed(frame) {
                if (frame % RESTRIKE_INTERVAL_QUANTA === 0) {
                    strike();
                }
                instance.process(QUANTUM);
            },
            rms() {
                const ptr = instance.process(QUANTUM);
                return pointerRms(module, ptr, instance.get_right_ptr());
            },
        };
    };

    // -- Bacteria — multiband creative FX ----------------------------------
    //
    // Two rows, because one was misleading. `BacteriaEngine::new` ships every
    // creative stage disabled (`bacteria/engine.rs:220`), and `bandCount` and
    // `mix` do not switch any of them on — so this row is the crossover, the
    // alignment delays and the band sum, and nothing else. It is the floor
    // Bacteria costs before it does anything a user opened it for. Keep it,
    // and keep it labelled for what it is.
    if (wanted('bacteria')) {
        const instance = new dsp.BacteriaInstance(SAMPLE_RATE);
        instance.set_param('bandCount', 3);
        instance.set_param('mix', 1);
        devices.push(
            pointerEffect({
                id: 'bacteria',
                label: 'Bacteria (3 bands, mix 1.0, all stages off)',
                note: 'effect; no voice pool; engine.rs:220 ships every stage disabled',
                instance,
                module: dsp,
            })
        );
    }

    // -- Bacteria in Smudge — the STFT path --------------------------------
    //
    // The other end of the same device. Smudge is distortion mode 7
    // (`bacteria/distortion.rs:41`) and runs an overlap-add spectral blur with
    // a 2048-sample window (`distortion.rs:92-99`); bare parameter names
    // broadcast to every band (`engine.rs:50-52`), so all three carry one.
    // Enabling distortion also puts the oversampler in the path
    // (`engine.rs:327-332`).
    //
    // Its work arrives in bursts, so read its **mean**, not its median: the
    // median is the cost of a quantum that only filled the window. Natively the
    // two differ by about 7x.
    if (wanted('bacteria_smudge')) {
        const instance = new dsp.BacteriaInstance(SAMPLE_RATE);
        instance.set_param('bandCount', 3);
        instance.set_param('mix', 1);
        instance.set_param('distortionEnabled', 1);
        instance.set_param('distortionMode', 7);
        instance.set_param('drive', 0.6);
        devices.push(
            pointerEffect({
                id: 'bacteria_smudge',
                label: 'Bacteria (3 bands, distortion on, Smudge/STFT)',
                note: 'effect; no voice pool; distortionMode 7 = Smudge, distortion.rs:41',
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

    // -- Crust — true-peak mastering limiter -------------------------------
    //
    // Absent from both legs of this bench until now, while the native header
    // asserted Crust had "no Rust engine at all". It has had one — a
    // `#[wasm_bindgen]` `CrustInstance` with a `process` export
    // (`crust/mod.rs:22,32,69`) — and the committed `daw_dsp_bg.wasm` exports
    // it, so the wasm leg could always have measured it and simply never
    // listed it.
    //
    // Shipped defaults are already right: `CrustEngine::new` sets
    // `true_peak: true` and `oversampling: 4` (`crust/engine.rs:258-259`),
    // matching `DEFAULT_CRUST_PATCH` (`CrustPatch.ts:78`), so the 4x
    // oversampled inter-sample peak detector is in the path as in production.
    //
    // `gain` is raised to 6 dB so the row is actually limiting. The shared
    // excitation peaks near -2.1 dBFS against a shipped -0.3 dB ceiling, so at
    // the default 0 dB input gain the limiter never engages and the row would
    // time a gain stage — the same reason `proof` sets an explicit threshold.
    if (wanted('crust')) {
        const instance = new dsp.CrustInstance(SAMPLE_RATE);
        instance.set_param('gain', 6);
        instance.set_param('ceiling', -0.3);
        devices.push(
            pointerEffect({
                id: 'crust',
                label: 'Crust (true-peak limiting, 4x OS)',
                note: 'effect; no voice pool; CrustPatch.ts:78 ships ceiling -0.3, truePeak, OS 4',
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
        // The shipped patch, all three values from GrinderPatch.ts:299-301:
        // ampModel 'crunch-jcm', channel 1, gain 5. The earlier version of this
        // row used channel 2 / gain 8.2, which is the lead channel at high gain
        // — three triode stages instead of two, so it measured a heavier
        // circuit than the reference project ever instantiates.
        const instance = new dsp.GrinderInstance(SAMPLE_RATE);
        instance.set_param('ampModel', 1); // crunch-jcm
        instance.set_param('channel', 1); // shipped default, 2 triode stages
        instance.set_param('gain', 5); // shipped default
        instance.set_param('master', 8);
        instance.set_param('bass', 5);
        instance.set_param('mid', 5);
        instance.set_param('treble', 5);
        instance.set_param('fat', 0);
        const device = pointerEffect({
            id: 'grinder',
            label: 'Grinder (Crunch JCM, ch 1, gain 5 — shipped patch)',
            note: "effect; the shipped patch, GrinderPatch.ts:299-301 (ampModel 'crunch-jcm', channel 1, gain 5)",
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
    // Production asks for an instance-wide ceiling of 32 voices. The shipped
    // one-layer patch can use that whole ceiling.
    if (wanted('fermenter')) {
        const struck = 32;
        const instance = new dsp.FermenterInstance(SAMPLE_RATE, 32);
        instance.set_param('cutoff', 4000);
        instance.set_param('resonance', 0.4);
        for (const note of spreadNotes(struck)) {
            instance.note_on(note, 100);
        }
        devices.push(
            heldInstrument({
                id: 'fermenter',
                label: 'Fermenter (32 sounding voices, 1 layer)',
                note: 'fermenterProcessor.ts constructs an instance-wide ceiling of 32 voices',
                instance,
                module: dsp,
                struck,
                expectSounding: 32,
                activeVoices: () => instance.active_voices(),
            })
        );
    }

    // -- Fermenter under offline parameter automation ----------------------
    //
    // What these rows exist to decide: `fermenterProcessor.ts` keeps its
    // automation schedules in a plain growing `Array` (`_paramAutomation`) and
    // walks the whole of it once per `process()` call, on the audio thread
    // (`_applyParamAutomation`, called from `process` at line 527). Fermenter
    // declares ~105 automatable parameters and only 16 are bound today, so the
    // question in front of the binding-table work is what the walk costs at 90
    // and at 105 rather than at 16.
    //
    // The loop is **per schedule, not per scheduled event** — one entry per
    // distinct `paramId`, so the array length is bounded by the ordinal count,
    // and the segment cursor only ever moves forward. The per-entry work is a
    // segment-advance check, a linear interpolation, and — when the value moved
    // — one `set_param_by_id` call across the wasm-bindgen boundary into a
    // string-matched `MasterSynth::set_param` cascade. That call is the cost,
    // not the array walk, which is why this is measured rather than reasoned
    // about from the loop count.
    //
    // # Why the ordinals cycle
    //
    // Only 16 ordinals exist in `AUTOMATION_PARAM_NAMES` today; ordinal >= 16
    // early-returns in `set_param_by_id` and would measure nothing. So the 90-
    // and 105-schedule rows cycle `paramId % 16`. This is deliberate and it is
    // what makes the delta readable: the **set of parameters actually moved**
    // is identical across all three rows, so the DSP consequence of automation
    // is held constant and the 16 -> 90 -> 105 difference is the marginal
    // dispatch cost of extra schedules and nothing else.
    //
    // What that does not cover, and must not be claimed. The 16 live ordinals
    // are not a sample of Fermenter's parameters, they are the **cheap tail** of
    // it, and the bias has a direction:
    //
    // * All 16 land on cheap arms — `layer.rs:627+` has thirteen as plain field
    //   stores, and `cutoff`/`resonance`/`lfo_rate` as `SmoothedParam::set`.
    //   None of the 16 recomputes a coefficient inside `set_param`, and none
    //   loops the voice array.
    // * The unbound 89 include arms that do both: the nine EQ parameters in
    //   `FermenterDescriptor.ts:149-157` call `self.eq.set_band(...)` in
    //   `synth.rs` (a biquad recompute per call), and `drift` /
    //   `additive_partials` iterate all 32 voices (`layer.rs:691-702`).
    //
    // So these rows bound the **dispatch** of N schedules and nothing else. The
    // per-parameter DSP cost of the 89 is unmeasured and skews expensive. And
    // because `paramId % 16` holds the moved set constant by construction, the
    // step between the un-automated row and these carries **no** information
    // about how it scales with *distinct* parameters — do not read it as a cost
    // already paid.
    const AUTOMATION_ORDINAL_RANGES = [
        [0.6, 1.0], // 0  osc_level
        [2000, 6000], // 1  cutoff
        [0.2, 0.6], // 2  resonance
        [0.5, 6.0], // 3  lfo_rate
        [0.0, 0.5], // 4  lfo_filter_amount
        [0.0, 0.2], // 5  mod_lfo_to_pitch
        [0.0, 0.5], // 6  mod_env_to_filter
        [0.0, 0.5], // 7  mseg_to_filter
        [0.0, 0.5], // 8  unison_spread
        [0.0, 0.3], // 9  fm_level2
        [0.0, 0.3], // 10 fm_feedback
        [0.0, 0.2], // 11 noise_level
        [0.0, 0.5], // 12 grain_density
        [0.1, 0.5], // 13 grain_size
        [0.0, 0.3], // 14 grain_spray
        [0.0, 0.9], // 15 osc_waveform (stays inside the sine bucket; still a new value each quantum)
    ];

    /** 0.1 s of automation per segment at 48 kHz — a dense but realistic clip resolution. */
    const AUTOMATION_SEGMENT_FRAMES = 4_800;

    /**
     * Build `count` schedules in exactly the shape `_paramAutomation` holds,
     * covering `frames` of timeline. Built once at construction; nothing here
     * runs on the render path.
     */
    const buildAutomationSchedules = (count, frames) => {
        const schedules = [];
        const segmentCount = Math.ceil(frames / AUTOMATION_SEGMENT_FRAMES) + 1;
        for (let index = 0; index < count; index += 1) {
            const paramId = index % AUTOMATION_ORDINAL_RANGES.length;
            const [lo, hi] = AUTOMATION_ORDINAL_RANGES[paramId];
            const segments = [];
            // Deterministic, non-repeating within a schedule, and different per
            // schedule, so no two entries share a value trajectory.
            const at = (k) => lo + (hi - lo) * (0.5 + 0.5 * Math.sin((k * 0.7 + index) * 1.31));
            for (let k = 0; k < segmentCount; k += 1) {
                segments.push({
                    startFrame: k * AUTOMATION_SEGMENT_FRAMES,
                    endFrame: (k + 1) * AUTOMATION_SEGMENT_FRAMES,
                    startValue: at(k),
                    endValue: at(k + 1),
                });
            }
            schedules.push({ paramId, segments, segmentIndex: 0, lastValue: undefined });
        }
        return schedules;
    };

    /**
     * `_applyParamAutomation` from `fermenterProcessor.ts`, transcribed.
     *
     * Kept as a transcription rather than an import because the file is an
     * `AudioWorkletProcessor` subclass with a top-level `registerProcessor` and
     * a wasm `initSync` import; it cannot be loaded into this scope. Any edit to
     * the shipped loop must be mirrored here or this row stops describing it.
     */
    const applyParamAutomation = (instance, schedules, frame) => {
        for (let scheduleIndex = 0; scheduleIndex < schedules.length; scheduleIndex += 1) {
            const schedule = schedules[scheduleIndex];
            while (
                schedule.segmentIndex < schedule.segments.length - 1 &&
                frame >= schedule.segments[schedule.segmentIndex].endFrame
            ) {
                schedule.segmentIndex += 1;
            }
            const segment = schedule.segments[schedule.segmentIndex];
            let value = segment.startValue;
            if (segment.endFrame <= segment.startFrame || frame >= segment.endFrame) {
                value = segment.endValue;
            } else if (frame > segment.startFrame) {
                const fraction = (frame - segment.startFrame) / (segment.endFrame - segment.startFrame);
                value = segment.startValue + (segment.endValue - segment.startValue) * fraction;
            }
            if (value !== schedule.lastValue) {
                instance.set_param_by_id(schedule.paramId, value);
                schedule.lastValue = value;
            }
        }
    };

    const automatedFermenter = ({ id, scheduleCount }) => {
        const struck = 16;
        const instance = new dsp.FermenterInstance(SAMPLE_RATE, 32);
        instance.set_param('cutoff', 4000);
        instance.set_param('resonance', 0.4);
        for (const note of spreadNotes(struck)) {
            instance.note_on(note, 100);
        }
        // Sized from the quanta this row will actually render, not from a
        // literal. The first version hard-coded 30 000 at every call site, which
        // covers the default run and silently degrades every row to a bare
        // array walk at `--measure 30000` — the exact failure `verify` below is
        // supposed to catch, reachable by a flag.
        const coveredQuanta = (quantaBudget ?? 30_000) + 1_000;
        const schedules = buildAutomationSchedules(scheduleCount, coveredQuanta * QUANTUM);
        let frame = 0;
        let lastLeftPtr = 0;
        let visits = 0;
        let writes = 0;
        // Counted through the same wrapper the loop calls, so the tally cannot
        // drift from the calls actually issued. The alternative — re-deriving
        // in `verify` whether each value *would* have moved — reimplements the
        // predicate under test, which is the failure `quantum_bench_census.rs`
        // documents at length.
        //
        // The wrapper is therefore **inside the timed loop**, one monomorphic
        // call and an increment per write. It taxes the very thing being
        // measured, and it is left in because it taxes it in the safe
        // direction: it applies identically to every automation row, so in the
        // amplifier difference `(1050 - 105) / 945` it contributes 945 extra
        // wrapper calls to the numerator and nothing else. That can only make
        // the derived per-schedule cost too *large*, which is how the figure is
        // published.
        const countingInstance = {
            set_param_by_id(paramId, value) {
                writes += 1;
                instance.set_param_by_id(paramId, value);
            },
        };
        return {
            id,
            label: `Fermenter + ${scheduleCount} automated params (16 sounding voices, 1 layer)`,
            note:
                `_applyParamAutomation over ${scheduleCount} schedules then process(128); ordinals cycle ` +
                `paramId % 16 so the set of parameters moved matches the other automation rows`,
            render() {
                applyParamAutomation(countingInstance, schedules, frame);
                visits += schedules.length;
                frame += QUANTUM;
                lastLeftPtr = instance.process(QUANTUM);
                return lastLeftPtr;
            },
            verify() {
                const level = pointerRms(dsp, lastLeftPtr, instance.get_right_ptr());
                const active = instance.active_voices();
                // Occupancy, and — the part the first version could not see —
                // that the loop is still *doing the work being timed*.
                //
                // It checked `lastValue !== undefined`, which is true forever
                // after the first quantum, and a visit count, which rises
                // whether or not anything is written. Both stay green through
                // the failure they were written to catch: once `frame` runs off
                // the end of the segments every schedule pins to its last one,
                // the value stops changing, no `set_param_by_id` is issued, and
                // the row silently becomes a measurement of an array walk.
                //
                // So the gate is the **write ratio** — how many of the schedule
                // visits actually crossed the wasm boundary — plus a direct
                // check that no cursor has reached its final segment. A pinned
                // row reds on both.
                const writeRatio = visits === 0 ? 0 : writes / visits;
                const exhausted = schedules.filter(
                    (schedule) => schedule.segmentIndex >= schedule.segments.length - 1
                ).length;
                return {
                    ok: active === 16 && level > 1e-5 && writeRatio > 0.99 && exhausted === 0,
                    detail:
                        `active_voices() = ${active}, expected 16 from ${struck} note-ons, ` +
                        `output RMS ${level.toExponential(3)}, ${writes}/${visits} schedule visits wrote ` +
                        `through set_param_by_id (${(writeRatio * 100).toFixed(1)}%), ${exhausted}/${schedules.length} ` +
                        `schedules exhausted their segments, timeline covers ${coveredQuanta} quanta`,
                };
            },
        };
    };

    if (wanted('fermenter_automation_16')) {
        devices.push(
            automatedFermenter({ id: 'fermenter_automation_16', scheduleCount: 16 })
        );
    }
    if (wanted('fermenter_automation_90')) {
        devices.push(
            automatedFermenter({ id: 'fermenter_automation_90', scheduleCount: 90 })
        );
    }
    if (wanted('fermenter_automation_105')) {
        devices.push(
            automatedFermenter({ id: 'fermenter_automation_105', scheduleCount: 105 })
        );
    }
    // An amplifier, not a product configuration. Fermenter cannot have 1050
    // automatable parameters and this row does not claim it can.
    //
    // It exists because the first run of the three rows above came back FLAT —
    // 16, 90 and 105 schedules all measured within a microsecond of each other,
    // ~23 us above the un-automated Fermenter row. Flat is consistent with two
    // very different stories: a marginal per-schedule cost of zero, and a
    // marginal cost of tens of nanoseconds that 89 extra schedules cannot lift
    // above a clock good to about +/-10% on a 70 us row. Reporting "no
    // measurable difference" without separating those would have been the same
    // argue-from-shape mistake this whole table was built to stop.
    //
    // So this row runs 10x the ~105 target and the marginal cost is read as
    // (this row - the 105 row) / 945. That derived figure is an **upper bound**
    // on the marginal cost at 105, not an estimate of it: 1050 schedules and
    // their 1050 live segment objects are a working set well past L1, where 105
    // of them fit, so per-schedule cost here can only be dearer than in the
    // configuration being decided about.
    if (wanted('fermenter_automation_1050')) {
        devices.push(
            automatedFermenter({ id: 'fermenter_automation_1050', scheduleCount: 1050 })
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
        // One voice, same pool size, same velocity, same re-strike cadence.
        const soloInstance = new dsp.GrandBouleInstance(SAMPLE_RATE, 64);
        const soloReference = makeSoloReference({
            instance: soloInstance,
            module: dsp,
            strike: () => soloInstance.note_on(notes[Math.floor(notes.length / 2)], 0.8),
        });
        devices.push(
            heldInstrument({
                id: 'grand_boule',
                label: 'Grand Boule (64 voices, re-struck 1/s) — WORKER, not audio thread',
                note: 'grandBouleEngineCore.ts:143 constructs 64; live path is Worker + SAB ring (GrandBouleNode.ts:480-518), so this cost is not charged to the audio thread',
                instance,
                module: dsp,
                struck,
                restrike: strike,
                soloReference,
            })
        );
    }

    // -- Grand Boule's ring consumer — what the audio thread ACTUALLY pays ----
    //
    // The live transport registers exactly one thing on the audio thread: a
    // worklet that copies rendered frames out of the SAB ring. This row times
    // the **real shipped** `readBlockAcquire` from
    // `worklets/grandBouleProcessor.ts` — the server strips its types on the
    // way out, so this is the function production runs, not a reproduction —
    // plus the surrounding `Atomics.load`s that `process()` performs per
    // quantum on the consuming path.
    //
    // The ring is kept ahead of the read head from here rather than by a
    // Worker, so the timed path is the steady *consuming* branch. The underrun
    // branch is cheaper (it fills silence and returns), so driving it would
    // understate the row.
    if (wanted('grand_boule_ring_consumer')) {
        const ringFrames = 8192;
        const controlInts = new Int32Array(new SharedArrayBuffer(ring.GRAND_BOULE_CONTROL_HEADER_BYTES));
        const leftRing = new Float32Array(ringFrames);
        const rightRing = new Float32Array(ringFrames);
        for (let i = 0; i < ringFrames; i += 1) {
            const value = Math.sin((i / SAMPLE_RATE) * 220 * Math.PI * 2) * 0.5;
            leftRing[i] = value;
            rightRing[i] = value;
        }
        const out0 = new Float32Array(QUANTUM);
        const out1 = new Float32Array(QUANTUM);
        let consumedCount = 0;
        let underruns = 0;

        devices.push({
            id: 'grand_boule_ring_consumer',
            label: 'Grand Boule ring consumer (the live audio-thread cost)',
            note: 'the only Grand Boule code on the audio thread in the live transport; real readBlockAcquire from grandBouleProcessor.ts',
            feed() {
                // Keep the producer ahead of the consumer, the way the engine
                // Worker does. Untimed: production pays this on the Worker.
                const readHead = Atomics.load(controlInts, ring.GRAND_BOULE_READ_HEAD_IDX);
                Atomics.store(controlInts, ring.GRAND_BOULE_WRITE_HEAD_IDX, (readHead + 4 * QUANTUM) | 0);
            },
            render() {
                // The per-quantum work `GrandBouleProcessor.process` does on the
                // consuming path: the flush-generation check, the read-head
                // load, and the ring copy itself.
                const flushGeneration = Atomics.load(controlInts, ring.GRAND_BOULE_FLUSH_GENERATION_IDX);
                const readHead = Atomics.load(controlInts, ring.GRAND_BOULE_READ_HEAD_IDX);
                const consumed = readBlockAcquire(controlInts, leftRing, rightRing, ringFrames, out0, out1, QUANTUM);
                if (consumed) {
                    Atomics.store(controlInts, ring.GRAND_BOULE_READ_HEAD_IDX, (readHead + QUANTUM) | 0);
                    consumedCount += 1;
                } else {
                    underruns += 1;
                }
                return flushGeneration + (consumed ? 1 : 0);
            },
            verify() {
                let sum = 0;
                for (let i = 0; i < QUANTUM; i += 1) {
                    sum += out0[i] * out0[i] + out1[i] * out1[i];
                }
                const level = Math.sqrt(sum / (2 * QUANTUM));
                return {
                    ok: level > 1e-5 && underruns === 0 && consumedCount > 0,
                    detail:
                        `${consumedCount} quanta consumed, ${underruns} underruns (must be 0 — an underrun ` +
                        `takes the cheap silence branch), output RMS ${level.toExponential(3)}`,
                };
            },
        });
    }

    // -- Toaster — drum machine --------------------------------------------
    // `toasterProcessor.ts:215` constructs `TOASTER_PAD_COUNT` = 16 pads.
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
        // One pad, same gain, same cadence — the occupancy denominator.
        const soloInstance = new dsp.ToasterInstance(SAMPLE_RATE, 16);
        soloInstance.set_param('master_gain', 0.63);
        const soloReference = makeSoloReference({
            instance: soloInstance,
            module: dsp,
            strike: () => soloInstance.note_on(0, 127, 36),
        });
        devices.push(
            heldInstrument({
                id: 'toaster',
                label: 'Toaster (16 pads, re-struck 1/s)',
                note: 'toasterProcessor.ts:215 constructs TOASTER_PAD_COUNT = 16',
                instance,
                module: dsp,
                struck,
                restrike: strike,
                soloReference,
            })
        );
    }

    // -- Levain — orchestral sample instrument ------------------------------
    //
    // `levainProcessor.ts:155` constructs 64 voices, which is also
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
            0, sampleId, 0, 69, 0.0, 0, 127, 0, 127, 0, 1, 0, false, 1, 0, frameCount, 0, 0.0, 0.005, 0.1, 1.0, 0.3
        );
        instance.build_zone_map(1, 1);
        for (const note of spreadNotes(struck)) {
            instance.note_on(note, 100);
        }
        devices.push(
            heldInstrument({
                id: 'levain',
                label: 'Levain (32 sounding voices, looped zone)',
                note: 'levainProcessor.ts:155 constructs 64 = MAX_VOICES_WASM; shipped legato collapses 64 note-ons to 32 voices',
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
    // `crumbsProcessor.ts:106` takes no voice argument; the pool is the crate's
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
                note: 'crumbsProcessor.ts:106 takes no voice count; crate MAX_VOICES = 128',
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
