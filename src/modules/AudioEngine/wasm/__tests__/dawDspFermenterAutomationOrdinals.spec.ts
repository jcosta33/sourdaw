import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mapFermenterParamToDspParam } from '#/modules/Fermenter/useCases';

import { FERMENTER_AUTOMATION_PARAM_IDS } from '../../engine/FermenterNode';
import { initSync, FermenterInstance } from '../daw_dsp.js';

const FRAMES = 128;
const BLOCKS = 12;
/** For rows whose two values need longer than 32 ms to separate. */
const LONG_BLOCKS = 48;
const wasmBytes = readFileSync(resolve(process.cwd(), 'public/wasm/daw-dsp/daw_dsp_bg.wasm'));
const wasm = initSync({ module: new WebAssembly.Module(wasmBytes) });

/**
 * Ordinal pin for the whole offline automation map, against the shipped binary.
 *
 * The scheduled path bypasses the WASM string bridge: TS posts an *ordinal* and
 * Rust indexes `AUTOMATION_PARAM_NAMES` positionally. Nothing type-checks that
 * index `n` means the same parameter on both sides, so a transposition
 * repoints automation at a different parameter — an automated level ride
 * bouncing as a filter sweep — with no compile error and no test failure.
 *
 * The guard before this one pinned ordinal 15 only. Every other transposition
 * was silent: swapping ordinals 0 and 1 left `cargo test -p daw-dsp` at
 * `505 passed; 0 failed`, exit 0.
 *
 * **A name pin turned out to be writable after all.** The claim it was not
 * rested on the two sides spelling parameters differently on purpose. They do —
 * and `mapFermenterParamToDspParam` is the production translation between those
 * spellings, the same one the live path uses to reach `set_param`. It
 * reproduces every Rust name from its TS key, including every spelling cited as
 * the reason this was impossible: `oscLevel` → `osc_level`, `lfoPitchAmount` →
 * `mod_lfo_to_pitch`, `filterCutoff` → `cutoff`. So the population is derived,
 * not listed, and it scaled from 16 rows to 102.
 *
 * The expected Rust names are **read out of `crates/daw-dsp/src/fermenter/mod.rs`
 * at test time**, not restated here. Restating 102 names would create a third
 * registry that can drift from both of the two it claims to bind, and per
 * ADR 0015 rule 3 a comparison between two hand-written constants is not a pin.
 * The source-text read catches name and order drift; the per-ordinal
 * behavioural pin below catches the source drifting from the shipped binary.
 *
 * Per ordinal, three renders of one note through a real `FermenterInstance`:
 *
 *  - `baseline` — the probe parameter set **by name** to `from`
 *  - `byName`   — the probe parameter set **by name** to `to`
 *  - `byId`     — the probe parameter set **by ordinal** to `to`
 *
 * and two assertions:
 *
 *  1. `byName !== baseline` — the probe actually moves this engine. Without it
 *     the pin is vacuous: a parameter whose probe changes nothing renders
 *     identically under every ordinal, so a transposition would agree too. This
 *     is the trap that let an RT guard sit at the default `unison_voices` of 1,
 *     where the allocating branch early-returns — which is exactly why
 *     `unisonSpread` below carries a prelude that raises the voice count. It is
 *     also this repository's per-parameter statement that *automating the
 *     parameter changes the rendered audio*: every row here names two values and
 *     proves the engine renders them differently.
 *  2. `byId === byName`, sample for sample — the ordinal names *this*
 *     parameter, not merely *some* parameter.
 *
 * A transposition fails (2) in both directions: the by-id arm either renders a
 * different parameter's change, or renders nothing and collapses onto baseline.
 *
 * **Defaults are the uninteresting branch far more often than not.** Most of
 * these parameters are inert at the state `FermenterInstance::new` leaves: the
 * global effect chain is gated on a `*_mix` that defaults to 0, the EQ bands are
 * flat until a gain is dialled in, the LFO and step sequencer are stopped, and
 * six of the seven oscillator engines are not selected. Every such row carries a
 * `prelude` that commits the state its interesting branch needs, and every row's
 * `why` says what the engine does differently between `from` and `to`.
 */

type OrdinalProbe = {
    /** Parameters set by name, in both arms, to make the probed one audible. */
    prelude?: ReadonlyArray<readonly [string, number]>;
    /**
     * Play and release this note before the probed one. Glide has no origin
     * until a previous note has sounded, so a portamento row parked on a single
     * note-on is green over an engine that never glided.
     */
    priorNote?: number;
    /**
     * Release the probed note this many blocks in. Release-stage envelope
     * parameters are unreachable while a note is held, so a row that never
     * releases proves nothing about them.
     */
    releaseAfterBlocks?: number;
    /**
     * The note to probe with, when 60 is a neutral point. Keytracking pivots on
     * middle C, so at note 60 its ratio is 1 whatever the tracking amount is.
     */
    note?: number;
    /**
     * Quanta to render, when `BLOCKS` is too short for the parameter to act.
     * Envelope decay/sustain stages, a slow step sequencer and a reverb tail all
     * need more than 32 ms before the two values have separated, and the default
     * is kept short because it is paid 3x on every one of the rows that do not.
     */
    blocks?: number;
    from: number;
    to: number;
    /** Why these two values differ to the engine. */
    why: string;
};

/**
 * Engine indices are `voice.rs`: 0 wavetable, 1 polyblep, 2 FM, 3 Karplus-Strong,
 * 4 granular, 5 additive, 6 sampler. A parameter belonging to an engine the
 * default patch does not select is dead until its engine is selected, so those
 * rows carry a prelude rather than a wider value range.
 */
const ORDINAL_PROBES: Readonly<Record<string, OrdinalProbe>> = {
    // ── Oscillator ──────────────────────────────────────────────────────
    oscLevel: { from: 0.8, to: 0.15, why: 'oscillator amplitude, away from the 0.8 default' },
    oscEngine: { from: 0, to: 2, why: 'the wavetable engine versus the FM engine' },
    oscCoarse: { from: 0, to: 12, why: 'an octave of transpose' },
    oscFine: { from: 0, to: 100, why: 'a full semitone of fine detune' },
    oscWaveform: { from: 0, to: 2, why: 'sine versus square wavetable; neither is the saw default' },
    pulseWidth: {
        prelude: [
            ['engine', 1],
            ['osc_waveform', 2],
        ],
        from: 0.5,
        to: 0.05,
        why: 'a square is symmetric and a 5% pulse is not; pulse width is dead on the wavetable engine',
    },
    oscDrift: { from: 0, to: 1, why: 'per-voice analogue pitch drift off versus full' },

    // ── Unison ──────────────────────────────────────────────────────────
    unisonVoices: {
        prelude: [['unison_detune', 40]],
        from: 1,
        to: 8,
        why: 'one voice versus an eight-voice bank; the prelude detunes the bank so it is not eight copies in phase',
    },
    unisonDetune: {
        prelude: [['unison_voices', 8]],
        from: 0,
        to: 60,
        why: 'detune spread across the bank; at the default of 1 voice there is no bank to detune',
    },
    unisonSpread: {
        prelude: [['unison_voices', 8]],
        from: 0.7,
        to: 0,
        why: 'stereo spread across a unison bank; at the default of 1 voice there is no bank to spread',
    },

    // ── Noise ───────────────────────────────────────────────────────────
    noiseLevel: { from: 0, to: 1, why: 'noise layer silent versus full against a tonal note' },
    noiseColor: {
        prelude: [['noise_level', 1]],
        from: 0,
        to: 2,
        why: 'white versus the third noise colour; colour is inaudible while the noise layer is silent',
    },

    // ── Time-domain warp ────────────────────────────────────────────────
    warpMode: {
        prelude: [['warp_amount', 1]],
        from: 0,
        to: 3,
        why: 'two different warp shapes; mode does nothing at the default warp amount of 0',
    },
    warpAmount: {
        prelude: [['warp_mode', 1]],
        from: 0,
        to: 1,
        why: 'warp bypassed versus fully applied, with a warp mode selected',
    },

    // ── Audio-rate modulation ───────────────────────────────────────────
    // `Voice::render` gates the whole audio-rate modulator on
    // `audio_mod_depth > 0.001 && audio_mod_target > 0`, and the target defaults
    // to 0 (off) — so a rate or depth row without a target prelude drives a
    // branch the engine never enters.
    audioModRate: {
        prelude: [
            ['audio_mod_depth', 1],
            ['audio_mod_target', 2],
        ],
        from: 0,
        to: 800,
        why: 'a stopped modulator versus an 800 Hz one, routed to amplitude so it is audible',
    },
    audioModDepth: {
        prelude: [
            ['audio_mod_rate', 500],
            ['audio_mod_target', 2],
        ],
        from: 0,
        to: 1,
        why: 'depth is dead while the modulator is stopped or unrouted; the prelude runs it and routes it',
    },
    audioModTarget: {
        prelude: [
            ['audio_mod_rate', 500],
            ['audio_mod_depth', 1],
        ],
        from: 0,
        to: 2,
        why: 'two different modulation destinations, with the modulator running',
    },

    // ── Additive engine ─────────────────────────────────────────────────
    additivePartials: {
        prelude: [['engine', 5]],
        from: 4,
        to: 64,
        why: 'four partials versus sixty-four, on the additive engine',
    },
    additiveTilt: {
        prelude: [['engine', 5]],
        from: -6,
        to: 6,
        why: 'the spectral tilt inverted end to end, on the additive engine',
    },
    additiveOdd: {
        prelude: [['engine', 5]],
        from: 0,
        to: 1,
        why: 'even harmonics present versus fully attenuated, on the additive engine',
    },
    additiveInharm: {
        prelude: [['engine', 5]],
        from: 0,
        to: 0.1,
        why: 'harmonic versus maximally stretched partials, on the additive engine',
    },

    // ── Karplus-Strong ──────────────────────────────────────────────────
    ksDamping: {
        prelude: [['engine', 3]],
        from: 0,
        to: 0.99,
        why: 'an undamped string versus a nearly dead one, on the Karplus-Strong engine',
    },
    ksBrightness: {
        prelude: [['engine', 3]],
        from: 0.1,
        to: 1,
        why: 'a dull excitation versus a bright one, on the Karplus-Strong engine',
    },

    // ── Granular ────────────────────────────────────────────────────────
    grainDensity: { prelude: [['engine', 4]], from: 20, to: 100, why: 'grains per second, on the granular engine' },
    grainSize: { prelude: [['engine', 4]], from: 50, to: 400, why: 'grain length, on the granular engine' },
    grainPosition: {
        prelude: [['engine', 4]],
        from: 0,
        to: 0.9,
        why: 'read position at the head versus near the end of the source, on the granular engine',
    },
    grainSpray: { prelude: [['engine', 4]], from: 0.1, to: 1, why: 'grain position jitter, on the granular engine' },
    grainPitchVar: {
        prelude: [['engine', 4]],
        from: 0,
        to: 12,
        why: 'grains all at pitch versus scattered across an octave, on the granular engine',
    },
    grainPanSpread: {
        // Two interior values, neither of them the 0.5 default. The ends would
        // work here — 0 is a hard-centred image — but this parameter reaches the
        // output through a balance whose divisor is clamped, and a row parked on
        // 0 and 1 could not tell a working pan from one that only resolved the
        // extremes.
        prelude: [['engine', 4]],
        from: 0.15,
        to: 0.85,
        why: 'a nearly centred grain cloud versus a wide one, on the granular engine; the pan is per-grain, so it is dead on every other engine',
    },

    // ── Sampler ─────────────────────────────────────────────────────────
    // `SamplerEngine::new` seeds a decaying sine burst, so the sampler engine
    // sounds without a loaded sample and these rows need no sample fixture.
    samplerMode: {
        prelude: [
            ['engine', 6],
            ['sampler_end', 0.02],
        ],
        from: 0,
        to: 1,
        why: 'one-shot stops at the end point, loop returns to the start; the short end point makes the difference land inside the window',
    },
    samplerStart: {
        prelude: [['engine', 6]],
        from: 0,
        to: 0.9,
        why: 'playback starting at the head of the burst versus after its envelope has decayed',
    },
    samplerEnd: {
        prelude: [
            ['engine', 6],
            ['sampler_mode', 1],
        ],
        from: 0.02,
        to: 1,
        why: 'a very short loop versus the whole buffer, in loop mode where the end point is read',
    },

    // ── Per-voice drive ─────────────────────────────────────────────────
    voiceDrive: { from: 0, to: 10, why: 'the per-voice waveshaper bypassed versus fully driven' },

    // ── Filter ──────────────────────────────────────────────────────────
    filterCutoff: { from: 5000, to: 250, why: 'cutoff below the note partials rather than above them' },
    filterResonance: { from: 1, to: 18, why: 'near-self-oscillating Q against the flat default' },
    filterModel: {
        prelude: [
            ['cutoff', 700],
            ['resonance', 10],
        ],
        from: 0,
        to: 4,
        why: 'two filter topologies; the prelude puts cutoff into the partials and raises Q so the models can separate',
    },
    filterMode: {
        prelude: [['cutoff', 700]],
        from: 0,
        to: 2,
        why: 'lowpass versus highpass at a cutoff inside the note spectrum',
    },
    filterDrive: { from: 0, to: 10, why: 'the filter input stage clean versus fully driven' },
    filterKeytrack: {
        prelude: [['cutoff', 400]],
        // `Voice::render` computes `2^((note - 60)/12 * keytrack)`, so at the
        // harness's default note of 60 the ratio is 1 for every keytrack value
        // and the row would be green over a parameter that never moved.
        note: 84,
        from: 0,
        to: 1,
        why: 'cutoff fixed versus following the note two octaves above the tracking pivot, from a cutoff low enough for the tracking to move it audibly',
    },
    filterEnvAmount: { from: 0.5, to: -1, why: 'inverts the filter envelope from the 0.5 default' },

    // ── FM engine ───────────────────────────────────────────────────────
    fmAlgorithm: {
        prelude: [['engine', 2]],
        from: 0,
        to: 5,
        why: 'two different operator routings, on the FM engine',
    },
    fmRatio1: { prelude: [['engine', 2]], from: 1, to: 8, why: 'operator 1 frequency ratio, on the FM engine' },
    fmRatio2: { prelude: [['engine', 2]], from: 1, to: 8, why: 'operator 2 frequency ratio, on the FM engine' },
    fmRatio3: {
        prelude: [
            ['engine', 2],
            ['fm_algorithm', 5],
        ],
        from: 1,
        to: 8,
        why: 'operator 3 frequency ratio, on an algorithm that routes operator 3',
    },
    fmRatio4: {
        prelude: [
            ['engine', 2],
            ['fm_algorithm', 5],
        ],
        from: 1,
        to: 8,
        why: 'operator 4 frequency ratio, on an algorithm that routes operator 4',
    },
    fmLevel1: { prelude: [['engine', 2]], from: 1, to: 0, why: 'operator 1 level, on the FM engine' },
    fmLevel2: { prelude: [['engine', 2]], from: 0.8, to: 0, why: 'operator 2 level, on the FM engine' },
    fmLevel3: {
        prelude: [
            ['engine', 2],
            ['fm_algorithm', 5],
        ],
        from: 1,
        to: 0,
        why: 'operator 3 level, on an algorithm that routes operator 3',
    },
    fmLevel4: {
        prelude: [
            ['engine', 2],
            ['fm_algorithm', 5],
        ],
        from: 1,
        to: 0,
        why: 'operator 4 level, on an algorithm that routes operator 4',
    },
    fmFeedback: { prelude: [['engine', 2]], from: 0, to: 1, why: 'operator feedback, on the FM engine' },
    fmModAmount: {
        prelude: [['engine', 2]],
        from: 0,
        to: 4,
        why: 'modulation index off versus full, on the FM engine',
    },

    // ── Amp envelope ────────────────────────────────────────────────────
    ampAttack: { from: 0.001, to: 2, why: 'an instant attack versus a two-second one, inside the rendered window' },
    ampDecay: {
        blocks: LONG_BLOCKS,
        from: 0.001,
        to: 5,
        why: 'decay to the 0.7 sustain immediately versus not reaching it inside the window',
    },
    ampSustain: {
        blocks: LONG_BLOCKS,
        prelude: [['amp_decay', 0.002]],
        from: 0,
        to: 1,
        why: 'silence versus full level after the decay; the prelude makes the decay finish inside the window',
    },
    ampRelease: {
        releaseAfterBlocks: 4,
        from: 0.001,
        to: 8,
        why: 'an instant cutoff versus an eight-second tail; release is unreachable while the note is held',
    },

    // ── Filter envelope ─────────────────────────────────────────────────
    filterAttack: { from: 0.001, to: 2, why: 'the filter envelope arriving immediately versus still rising' },
    filterDecay: {
        blocks: LONG_BLOCKS,
        from: 0.001,
        to: 5,
        why: 'the filter envelope collapsing to sustain versus still falling',
    },
    filterSustain: {
        blocks: LONG_BLOCKS,
        prelude: [['filter_decay', 0.002]],
        from: 0,
        to: 1,
        why: 'the filter envelope settling closed versus open; the prelude makes the decay finish inside the window',
    },
    filterRelease: {
        releaseAfterBlocks: 4,
        from: 0.001,
        to: 8,
        why: 'the filter envelope snapping shut versus holding open through the tail',
    },

    // ── LFO ─────────────────────────────────────────────────────────────
    lfoRate: {
        prelude: [['lfo_filter_amount', 1]],
        from: 0,
        to: 30,
        why: 'a stopped LFO modulates nothing; the prelude gives it a destination',
    },
    lfoShape: {
        prelude: [
            ['lfo_rate', 12],
            ['lfo_filter_amount', 1],
        ],
        from: 0,
        to: 2,
        why: 'two different LFO waveforms; shape is inert while the LFO is stopped or undestined',
    },
    lfoPitchAmount: {
        prelude: [['lfo_rate', 8]],
        from: 0,
        to: 1,
        why: 'depth is dead while the LFO is stopped; the prelude runs it',
    },
    lfoFilterAmount: {
        prelude: [['lfo_rate', 8]],
        from: 0,
        to: 1,
        why: 'depth is dead while the LFO is stopped; the prelude runs it',
    },

    // ── MSEG ────────────────────────────────────────────────────────────
    msegToFilter: { from: 0, to: 1, why: 'MSEG→filter depth off versus full' },

    // ── Step sequencer ──────────────────────────────────────────────────
    seqRate: {
        blocks: LONG_BLOCKS,
        prelude: [['seq_to_pitch', 1]],
        from: 0.5,
        to: 20,
        why: 'two steps versus eighty inside the window; rate is inert while the sequencer has no destination',
    },
    seqToPitch: {
        prelude: [['seq_rate', 12]],
        from: 0,
        to: 1,
        why: 'the sequencer disconnected from pitch versus driving it, with the sequencer running',
    },

    // ── Portamento ──────────────────────────────────────────────────────
    portamentoTime: {
        priorNote: 48,
        from: 0,
        to: 2,
        why: 'an instant jump versus a two-second glide from the prior note; glide has no origin without one',
    },
    portamentoMode: {
        // Both arms play and release note 48 before the probed note, so no key
        // is down when either note starts. `Layer::portamento_time_for_note_on`
        // therefore suppresses the glide on both of them in legato mode and on
        // neither of them in always mode. The prelude is what makes the switch
        // reachable at all: at the default glide time of 0 every note snaps
        // whichever mode is selected, and the row would be green over an engine
        // that ignored the field — which is exactly what it did until
        // `Layer::portamento_time_for_note_on` existed.
        prelude: [['portamento', 5]],
        priorNote: 48,
        from: 0,
        to: 1,
        why: 'always-glide versus legato-only, with no key held at either note-on, so mode 1 snaps where mode 0 glides',
    },

    // ── Reverb ──────────────────────────────────────────────────────────
    reverbType: { from: 0, to: 1, why: 'the plate algorithm versus the FDN one, at the 0.2 default mix' },
    reverbMix: { from: 0, to: 1, why: 'dry versus fully wet' },
    reverbDecay: {
        blocks: LONG_BLOCKS,
        prelude: [['reverb_mix', 1]],
        from: 0,
        to: 0.99,
        why: 'a dead room versus a long one, fully wet so the tail is not buried',
    },

    // ── EQ ──────────────────────────────────────────────────────────────
    // Every band is flat at its default gain of 0 dB, so frequency and Q are
    // inert until a gain is dialled in. Those rows carry the gain prelude; the
    // gain rows themselves ride from full cut to full boost.
    eqLowFreq: {
        prelude: [['eq_low_gain', 18]],
        from: 20,
        to: 500,
        why: 'the boosted low band moved across its range',
    },
    eqLowGain: { from: -24, to: 24, why: 'the low band fully cut versus fully boosted' },
    eqLowQ: { prelude: [['eq_low_gain', 18]], from: 0.1, to: 10, why: 'the boosted low band broad versus narrow' },
    eqMidFreq: {
        prelude: [['eq_mid_gain', 18]],
        from: 200,
        to: 8000,
        why: 'the boosted mid band moved across its range',
    },
    eqMidGain: { from: -24, to: 24, why: 'the mid band fully cut versus fully boosted' },
    eqMidQ: { prelude: [['eq_mid_gain', 18]], from: 0.1, to: 10, why: 'the boosted mid band broad versus narrow' },
    eqHighFreq: {
        prelude: [['eq_high_gain', 18]],
        from: 2000,
        to: 20000,
        why: 'the boosted high band moved across its range',
    },
    eqHighGain: { from: -24, to: 24, why: 'the high band fully cut versus fully boosted' },
    eqHighQ: { prelude: [['eq_high_gain', 18]], from: 0.1, to: 10, why: 'the boosted high band broad versus narrow' },

    // ── Delay ───────────────────────────────────────────────────────────
    delayTime: {
        prelude: [['delay_mix', 0.7]],
        from: 10,
        to: 2000,
        why: 'repeats inside the rendered window versus a delay longer than it; the whole delay is bypassed at the default mix of 0',
    },
    delayFeedback: {
        prelude: [
            ['delay_mix', 0.7],
            ['delay_time', 10],
        ],
        from: 0,
        to: 0.95,
        why: 'one repeat versus a regenerating train, at a delay short enough for several to land in the window',
    },
    delayMix: { from: 0, to: 1, why: 'the delay bypassed versus fully wet' },

    // ── Chorus ──────────────────────────────────────────────────────────
    chorusRate: {
        prelude: [['chorus_mix', 1]],
        from: 0.1,
        to: 5,
        why: 'a nearly static delay line versus a 5 Hz sweep; the chorus is bypassed at the default mix of 0',
    },
    chorusDepth: {
        prelude: [['chorus_mix', 1]],
        from: 0,
        to: 1,
        why: 'no modulation depth versus full, with the chorus engaged',
    },
    chorusMix: { from: 0, to: 1, why: 'the chorus bypassed versus fully wet' },

    // ── Phaser ──────────────────────────────────────────────────────────
    phaserRate: {
        prelude: [['phaser_mix', 1]],
        from: 0.1,
        to: 5,
        why: 'a nearly static notch versus a 5 Hz sweep; the phaser is bypassed at the default mix of 0',
    },
    phaserDepth: {
        prelude: [['phaser_mix', 1]],
        from: 0,
        to: 1,
        why: 'no notch travel versus full, with the phaser engaged',
    },
    phaserMix: { from: 0, to: 1, why: 'the phaser bypassed versus fully wet' },

    // ── Distortion ──────────────────────────────────────────────────────
    distDrive: {
        prelude: [['dist_mix', 1]],
        from: 0,
        to: 10,
        why: 'clean versus fully driven; the distortion is bypassed at the default mix of 0',
    },
    distTone: {
        prelude: [
            ['dist_mix', 1],
            ['dist_drive', 6],
        ],
        from: 0,
        to: 1,
        why: 'the post-distortion tone control dark versus bright, with drive up so there is harmonic content to shape',
    },
    distMix: {
        prelude: [['dist_drive', 6]],
        from: 0,
        to: 1,
        why: 'dry versus fully distorted, with drive up so the wet path differs from the dry one',
    },

    // ── Compressor ──────────────────────────────────────────────────────
    compThreshold: {
        prelude: [['comp_mix', 1]],
        from: -60,
        to: 0,
        why: 'everything compressed versus nothing; the compressor is bypassed at the default mix of 0',
    },
    compRatio: {
        prelude: [
            ['comp_mix', 1],
            ['comp_threshold', -40],
        ],
        from: 1,
        to: 20,
        why: 'unity versus 20:1 above a threshold the signal is well over',
    },
    compAttack: {
        prelude: [
            ['comp_mix', 1],
            ['comp_threshold', -40],
            ['comp_ratio', 20],
        ],
        from: 0.1,
        to: 100,
        why: 'gain reduction arriving in 0.1 ms versus 100 ms, so the note transient survives or does not',
    },
    compRelease: {
        prelude: [
            ['comp_mix', 1],
            ['comp_threshold', -40],
            ['comp_ratio', 20],
        ],
        from: 10,
        to: 1000,
        why: 'gain recovering inside the window versus staying pinned down through it',
    },
    compMix: {
        prelude: [
            ['comp_threshold', -40],
            ['comp_ratio', 20],
        ],
        from: 0,
        to: 1,
        why: 'the compressor bypassed versus fully in circuit, with it set to actually reduce gain',
    },

    // ── Stereo, layers, chaos, master ───────────────────────────────────
    stereoWidth: {
        prelude: [['layer_pan', 0.7]],
        from: 0,
        to: 2,
        why: 'mono-summed versus doubled side content; width is a no-op on a signal whose channels are identical, which the default centred patch produces',
    },
    numLayers: { from: 1, to: 4, why: 'one layer sounding the note versus four' },
    layerLevel: { from: 1, to: 0.15, why: 'the active layer at full level versus near-silent' },
    layerPan: { from: -0.9, to: 0.9, why: 'the active layer hard left versus hard right' },
    chaosAmount: { from: 0, to: 1, why: 'the chaos modulator off versus full' },
    chaosSpeed: {
        prelude: [['chaos_amount', 1]],
        from: 0.01,
        to: 10,
        why: 'a nearly frozen chaos source versus a fast one; speed is inert at the default amount of 0',
    },
    masterGain: { from: 0.3, to: 1.8, why: 'well below versus well above unity' },
};

type RenderInput = {
    prelude?: ReadonlyArray<readonly [string, number]>;
    priorNote?: number;
    releaseAfterBlocks?: number;
    note?: number;
    blocks?: number;
    apply: (instance: FermenterInstance) => void;
};

const PRIOR_NOTE_BLOCKS = 4;
const DEFAULT_NOTE = 60;

function render({ prelude, priorNote, releaseAfterBlocks, note, blocks, apply }: RenderInput): number[] {
    const probedNote = note ?? DEFAULT_NOTE;
    const renderedBlocks = blocks ?? BLOCKS;
    const instance = new FermenterInstance(48_000, 8);
    try {
        for (const [name, value] of prelude ?? []) {
            instance.set_param(name, value);
        }
        apply(instance);
        if (priorNote !== undefined) {
            // Sound and release an earlier note so glide has an origin. Both
            // arms run it identically, so it cancels out of the comparison and
            // only the probed parameter can move the result.
            instance.note_on(priorNote, 100);
            for (let block = 0; block < PRIOR_NOTE_BLOCKS; block++) {
                instance.process(FRAMES);
            }
            instance.note_off(priorNote);
        }
        instance.note_on(probedNote, 100);
        const samples: number[] = [];
        for (let block = 0; block < renderedBlocks; block++) {
            if (releaseAfterBlocks !== undefined && block === releaseAfterBlocks) {
                instance.note_off(probedNote);
            }
            // Read immediately: a later allocation can detach the buffer.
            const leftBase = instance.process(FRAMES);
            const rightBase = instance.get_right_ptr();
            samples.push(
                ...new Float32Array(wasm.memory.buffer, leftBase, FRAMES),
                ...new Float32Array(wasm.memory.buffer, rightBase, FRAMES)
            );
        }
        return samples;
    } finally {
        instance.free();
    }
}

function totalDifference(left: number[], right: number[]): number {
    return left.reduce((sum, sample, index) => sum + Math.abs(sample - (right[index] ?? 0)), 0);
}

/**
 * `AUTOMATION_PARAM_NAMES` read out of the Rust source, in declaration order.
 * The array is the other half of the ordinal contract; reading it beats
 * restating it, because a restatement is a third registry with its own drift.
 */
function rustAutomationParamNames(): string[] {
    const source = readFileSync(resolve(process.cwd(), 'crates/daw-dsp/src/fermenter/mod.rs'), 'utf8');
    const array = /const AUTOMATION_PARAM_NAMES: \[&str; (\d+)\] = \[([\S\s]*?)\n\];/.exec(source);
    if (!array) {
        throw new Error('AUTOMATION_PARAM_NAMES not found in crates/daw-dsp/src/fermenter/mod.rs');
    }
    const names = [...array[2]!.matchAll(/"([a-z\d_]+)"/g)].map((match) => match[1]!);
    const declared = Number(array[1]);
    if (names.length !== declared) {
        throw new Error(`AUTOMATION_PARAM_NAMES declares ${declared} entries and lists ${names.length}`);
    }
    return names;
}

describe('checked-in Fermenter WASM automation ordinals', () => {
    it('derives every Rust parameter name from its TS key through the production translation', () => {
        // The claim that made a name pin look unwritable, tested rather than
        // assumed. If this ever stops holding, the pin below silently starts
        // comparing a parameter against itself under a name Rust ignores — so
        // this runs first and names the failure.
        const translated = Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).map((paramId) =>
            mapFermenterParamToDspParam({ paramId })
        );

        expect(translated).toEqual(rustAutomationParamNames());
        // Every ordinal in the map has a probe, so no row can be skipped by
        // omission — adding an ordinal without a probe fails here, not silently.
        expect(Object.keys(ORDINAL_PROBES).sort()).toEqual(Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).sort());
        // The ordinals are a dense 0..n-1 range, which is what indexing
        // `AUTOMATION_PARAM_NAMES` positionally requires.
        expect(Object.values(FERMENTER_AUTOMATION_PARAM_IDS).sort((a, b) => a - b)).toEqual(
            Object.keys(FERMENTER_AUTOMATION_PARAM_IDS).map((_, index) => index)
        );
    });

    it.each(Object.entries(FERMENTER_AUTOMATION_PARAM_IDS))(
        'ordinal for %s reaches that parameter and no other',
        (paramId, ordinal) => {
            const probe = ORDINAL_PROBES[paramId];
            if (!probe) {
                throw new Error(`no probe for ${paramId}`);
            }
            const dspName = mapFermenterParamToDspParam({ paramId });
            const arms = {
                prelude: probe.prelude,
                priorNote: probe.priorNote,
                releaseAfterBlocks: probe.releaseAfterBlocks,
                note: probe.note,
                blocks: probe.blocks,
            };

            const baseline = render({ ...arms, apply: (i) => i.set_param(dspName, probe.from) });
            const byName = render({ ...arms, apply: (i) => i.set_param(dspName, probe.to) });
            const byId = render({ ...arms, apply: (i) => i.set_param_by_id(ordinal, probe.to) });

            // (1) Liveness. Without this the equality below is satisfied by two
            // renders that both did nothing.
            expect(totalDifference(byName, baseline)).toBeGreaterThan(0.01);
            // (2) The ordinal is this parameter.
            expect(totalDifference(byId, byName)).toBe(0);
        }
    );
});
