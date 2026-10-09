import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Fermenter's sound sources — the engine selector,
 * oscillator, unison, noise, drift, warp, audio-rate modulation, the additive,
 * plucked-string, granular, sampler and FM engines, and per-voice drive —
 * taken from `crates/daw-dsp/src/fermenter` (`voice.rs`, `oscillator.rs`,
 * `noise.rs`, `spectral.rs`, `additive.rs`, `physical.rs`, `granular.rs`,
 * `sampler.rs`, `fm.rs`). Every id here is per layer: `MasterSynth::set_param`
 * hands it to the layer `activeLayer` selects.
 *
 * The agent reads these in eight-parameter manifest pages that must each fit
 * one tool receipt (`deviceManifestPaging.spec.ts`), so the text stays terse.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const FERMENTER_SOURCE_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    // ── Oscillator ─────────────────────────────────────────────────────────
    oscEngine: parameterGuidance(
        'Synthesis engine',
        'Selects 0 wavetable, 1 analog, 2 FM, 3 string, 4 granular, 5 additive or 6 sampler; the window stops at 5: the sampler plays only a built-in 440 Hz tone.',
        0,
        5,
        [
            'oscWaveform and unisonVoices act on engines 0 and 1, fm* on 2, ks* on 3, grain* on 4, additive* on 5, sampler* on 6.',
        ],
        ['The string is excited only at note-on, so switching a held note to engine 3 silences it.'],
        noExternalModulation
    ),
    oscWaveform: parameterGuidance(
        'Oscillator waveform',
        'Selects 0 sine, 1 saw, 2 square or 3 triangle on engines 0 and 1; saw and square harmonics fall as 1/n, triangle’s as 1/n².',
        1,
        2,
        ['Engine 1’s square reads pulseWidth; FM, string, granular (always saw), additive and sampler ignore it.'],
        ['It rewrites sounding notes on the next block, so automating it switches timbre abruptly.'],
        noExternalModulation
    ),
    oscLevel: parameterGuidance(
        'Oscillator level',
        'Scales the engine output (tables peak at 1) before noise and the filter; 0.5 to 1 is −6 dB to full scale.',
        0.5,
        1,
        ['noiseLevel is added after it; it sets how hard filterDrive and voiceDrive are driven.'],
        ['At 0 only noise reaches the filter.'],
        noExternalModulation
    ),
    oscCoarse: parameterGuidance(
        'Coarse transpose in semitones',
        'Transposes every engine in semitones; the window spans two octaves down but one up, as tables halve their harmonics per octave and partials past Nyquist drop.',
        -24,
        12,
        ['Adds to oscFine and every pitch modulation.'],
        ['The string’s 1/20 s buffer clamps any pitch below 20 Hz to 20 Hz.'],
        noExternalModulation
    ),
    oscFine: parameterGuidance(
        'Fine tune in cents',
        'Offsets pitch by up to ±100 cents; ±25 keeps a layer within a quarter-tone of the others.',
        -25,
        25,
        ['Adds to oscCoarse; per layer, so it detunes layers when numLayers is above 1.'],
        ['Past ±50 cents the layer sits nearer the next semitone, which oscCoarse reaches exactly.'],
        noExternalModulation
    ),
    pulseWidth: parameterGuidance(
        'Analog pulse width',
        'Sets the analog pulse duty (0.05 to 0.95); widths w and 1 − w share harmonic magnitudes, so 0.1 to 0.5 covers every tone.',
        0.1,
        0.5,
        ['Heard only with oscEngine 1, oscWaveform 2 and unisonVoices 1.'],
        ['Elsewhere, including engine 1 with unison, it does nothing.'],
        noExternalModulation
    ),

    // ── Unison ─────────────────────────────────────────────────────────────
    unisonVoices: parameterGuidance(
        'Unison copies per note',
        'Stacks up to 16 detuned wavetable copies per note at gain 1/√count.',
        1,
        8,
        ['unisonDetune and unisonSpread act only above 1; FM and engines 3 to 6 ignore it.'],
        ['On engine 1 values above 1 render the wavetable bank instead of the analog oscillator.'],
        noExternalModulation
    ),
    unisonDetune: parameterGuidance(
        'Unison detune',
        'Spreads copies evenly from −detune/2 to +detune/2 cents; 50 puts the outer copies 25 cents off the note.',
        0,
        50,
        ['Needs unisonVoices above 1; unisonSpread pans the same copies.'],
        ['At 100 the outer copies sit a full semitone apart (±50 cents).'],
        noExternalModulation
    ),
    unisonSpread: parameterGuidance(
        'Unison stereo spread',
        'Pans copies evenly across ±spread with equal power; at 1 the outer copies are hard left and right.',
        0.5,
        1,
        ['Needs unisonVoices above 1; stereoWidth scales its side.'],
        ['The pan is restored after the mono filter as a balance, exact only while one copy dominates.'],
        noExternalModulation
    ),

    // ── Noise and drift ────────────────────────────────────────────────────
    noiseLevel: parameterGuidance(
        'Noise level',
        'Adds noise peaking at ±level after oscLevel, before the filter; at 0.3 white-noise peaks sit about 10 dB under a full-scale oscillator.',
        0,
        0.3,
        ['noiseColor sets its colour; oscLevel does not scale it.'],
        ['At 1 noise peaks match a full-scale oscillator.'],
        noExternalModulation
    ),
    noiseColor: parameterGuidance(
        'Noise colour',
        'Selects 0 white, 1 pink (eight-row sum ÷ 9) or 2 brown (leaky integrator ×10, clamped to ±1).',
        0,
        1,
        ['Heard only when noiseLevel is above 0.'],
        ['Brown’s integrator spread (σ ≈ 0.29) puts about 70 % of samples on the ±1 clamp after ×10.'],
        noExternalModulation
    ),
    oscDrift: parameterGuidance(
        'Pitch drift',
        'Wanders pitch up to ±5 cents × amount at 0.18 and 0.51 Hz.',
        0,
        0.5,
        ['Multiplies the pitch set by oscCoarse, oscFine and the modulators.'],
        ['Written into existing voices only, so a voice swapped in from the steal-fade pool lacks it.'],
        noExternalModulation
    ),

    // ── Time-domain warp ──────────────────────────────────────────────────
    warpMode: parameterGuidance(
        'Warp algorithm',
        'Selects 0 off, 1 sync, 2 reduction, 3 squeeze, 4 bend, 5 formant, 6 fold; stops at 4 as fold reaches 3.4 × full scale and formant’s phase moves only on engine 0 and engine 1 with unisonVoices 1.',
        0,
        4,
        [
            'Needs warpAmount above 0.001; sync and formant’s phase is frozen on oscEngine 2–6 and engine 1 with unisonVoices above 1, so they only alter gain or offset.',
        ],
        ['Squeeze adds a 2 × amount − 1 DC bias, toward −1 at low amounts.'],
        noExternalModulation
    ),
    warpAmount: parameterGuidance(
        'Warp intensity',
        'At 0.5 reduction keeps 9 bits and holds each value about 8.5 samples (16 at 1; left and right share one counter); squeeze is unbiased.',
        0,
        0.5,
        ['Acts through warpMode; 0 is a bypass.'],
        ['Above about 0.71 fold outgrows its four folds; at 1 full scale leaves at up to 3.4.'],
        noExternalModulation
    ),

    // ── Audio-rate modulation ─────────────────────────────────────────────
    audioModRate: parameterGuidance(
        'Audio-rate modulator rate',
        'A fixed-Hz sine modulator, 0–5000 Hz, independent of the note; 0 outputs nothing.',
        0,
        1000,
        ['Needs audioModDepth above 0.001 and a non-zero audioModTarget; restarts each note-on.'],
        ['Fixed in Hz, one rate is harmonic on some notes and inharmonic on others.'],
        noExternalModulation
    ),
    audioModDepth: parameterGuidance(
        'Audio-rate modulation depth',
        'Scales the modulator to ±depth octaves of pitch, a 1 ± depth gain, or ±2 × depth on the cutoff multiplier.',
        0,
        0.5,
        ['audioModTarget picks the destination.'],
        ['At 1 amplitude gain swings 0 to 2; from 0.5 the filter trough hits 20 Hz.'],
        noExternalModulation
    ),
    audioModTarget: parameterGuidance(
        'Audio-rate modulation destination',
        'Selects 0 off, 1 pitch, 2 amplitude modulation (a 1 ± depth gain, 0 to 2) or 3 cutoff; the window stops at 2 since route 3 adds ±2 × depth to the cutoff multiplier.',
        0,
        2,
        ['audioModDepth and audioModRate do nothing while it is 0.'],
        ['Route 3 can pin the cutoff at 20 Hz on each trough.'],
        noExternalModulation
    ),

    // ── Additive ───────────────────────────────────────────────────────────
    additivePartials: parameterGuidance(
        'Additive partial count',
        'Sums up to 64 sines of a 1/n series over √count, so fewer are louder: 8 peak near 0.59, 32 near 0.32.',
        8,
        32,
        ['Engine 5; additiveTilt, additiveOdd and additiveInharm reshape them.'],
        ['Past 32, partials reach only fundamentals under about 727 Hz at 48 kHz, yet √count lowers every note.'],
        noExternalModulation
    ),
    additiveTilt: parameterGuidance(
        'Additive spectral tilt',
        'Multiplies partial n by (n − 1)^(tilt/6), about tilt dB per doubling; +6 lifts the peak from about 0.32 to 3.9.',
        -6,
        2,
        ['Combines with additiveOdd.'],
        ['At 32 partials a sweep to +6 raises the output over 20 dB (about 9 dB at 8).'],
        noExternalModulation
    ),
    additiveOdd: parameterGuidance(
        'Even-partial attenuation',
        'Scales even partials by 1 − amount: 0.5 is −6 dB, 0.9 is −20 dB, and 1 removes them.',
        0,
        0.9,
        ['Combines with additiveTilt on the same partials.'],
        ['Removing even partials also lowers level.'],
        noExternalModulation
    ),
    additiveInharm: parameterGuidance(
        'Additive inharmonicity',
        'Moves partial n to n × (1 + B·n²); at 0.01 the tenth partial sits on the twentieth harmonic.',
        0,
        0.01,
        [
            'Stretches the partials additivePartials enables; even the first rises by 1 + amount, about 17 cents at 0.01.',
        ],
        ['The engine stops at the first partial past Nyquist, so high values cut the partial count on upper notes.'],
        noExternalModulation
    ),

    // ── Plucked string ─────────────────────────────────────────────────────
    ksDamping: parameterGuidance(
        'String loop damping',
        'Sets the loop low-pass coefficient to 1 − 0.5 × damping each block; 0 has no loss filter, 0.99 gives about 0.5.',
        0.1,
        0.9,
        ['Engine 3 only; ksBrightness sets the excitation this decays.'],
        ['Near 0 the string barely decays, leaving ampSustain and ampRelease to end the note.'],
        noExternalModulation
    ),
    ksBrightness: parameterGuidance(
        'String excitation brightness',
        'Low-passes the note-on noise burst with coefficient 0.1 to 1; 1 is unfiltered.',
        0.3,
        1,
        ['Engine 3 only; ksDamping sets how fast it decays.'],
        ['Read only at note-on, so changes do not reach a ringing note.'],
        noExternalModulation
    ),

    // ── Granular ───────────────────────────────────────────────────────────
    grainDensity: parameterGuidance(
        'Grains started per second',
        'Starts a grain every 1/density s; at the default 50 ms size, 20 per second is the first density without gaps.',
        20,
        80,
        ['Overlap is density × grainSize; engine 4 only.'],
        ['At most 32 grains sound, so beyond that overlap new grains are skipped.'],
        noExternalModulation
    ),
    grainSize: parameterGuidance(
        'Grain length in milliseconds',
        'Sets each grain’s Hann-windowed length in milliseconds.',
        20,
        200,
        ['grainDensity × grainSize sets the overlap that degrades the grainPanSpread restore.'],
        ['Measured pan-restore error is 14.6 % at 20 grains/s and 200 ms, and 48.3 % at 100 grains/s and 500 ms.'],
        noExternalModulation
    ),
    grainPosition: parameterGuidance(
        'Grain start phase within the saw cycle',
        'Sets the start phase (0 to 1) within the single saw cycle grains read; it scans no sample, so 0 and 1 are the same.',
        0,
        0.5,
        ['grainSpray randomises the start around it.'],
        ['Grains repeat one saw cycle, so it moves only where each window opens on the cycle.'],
        noExternalModulation
    ),
    grainSpray: parameterGuidance(
        'Random spread of grain start phase',
        'Adds a random ±spray to each grain’s start phase, clamped to 0–1, not wrapped.',
        0,
        0.5,
        ['Spreads around grainPosition.'],
        ['With grainPosition at 0 every negative draw lands on 0, so the spread is one-sided.'],
        noExternalModulation
    ),
    grainPitchVar: parameterGuidance(
        'Random grain pitch spread in semitones',
        'Detunes each grain by a random ±value semitones at its start; ±2 stays within a whole tone.',
        0,
        2,
        ['Grains keep their start pitch, so portamentoTime and lfoPitchAmount reach only later grains.'],
        ['At 12 grains land anywhere in a two-octave band.'],
        noExternalModulation
    ),
    grainPanSpread: parameterGuidance(
        'Random grain pan spread',
        'Pans each grain randomly within ±spread with a linear law, restored as a balance after the mono filter.',
        0,
        0.8,
        ['Overlap from grainDensity × grainSize degrades the restore.'],
        ['Pans are random, so a passage can lean to one side until grains average out.'],
        noExternalModulation
    ),

    // ── Sampler ────────────────────────────────────────────────────────────
    samplerMode: parameterGuidance(
        'Sampler playback mode',
        'Selects 0 one-shot (64-sample end fade), 1 loop (64-sample crossfade) or 2 ping-pong (no crossfade).',
        0,
        1,
        ['samplerStart and samplerEnd set the region; engine 6 only.'],
        ['The source is a built-in 1 s 440 Hz tone that middle C plays at 440 Hz, nine semitones above the note.'],
        noExternalModulation
    ),
    samplerStart: parameterGuidance(
        'Sample start point',
        'Sets the start and loop start as a fraction of the 1 s source, which decays as e^(−8t): about −35 dB by 0.5.',
        0,
        0.5,
        ['samplerEnd stays at least 0.01 after it.'],
        ['Late starts begin in the quiet tail of the source.'],
        noExternalModulation
    ),
    samplerEnd: parameterGuidance(
        'Sample end point',
        'Sets where one-shots stop and loops turn, at least 0.01 past samplerStart.',
        0.25,
        1,
        ['Sets the region with samplerStart and samplerMode.'],
        ['A one-shot past its end is silent while the amp envelope still holds the voice.'],
        noExternalModulation
    ),

    // ── Per-voice drive ───────────────────────────────────────────────────
    voiceDrive: parameterGuidance(
        'Per-voice drive',
        'Drives each filtered voice by 1 + drive into a rational tanh reaching 1 at an input of 3; up to 2, full scale lands at that knee.',
        0,
        2,
        ['Follows filterDrive; oscLevel sets the level reaching both.'],
        ['The curve rises past 3 (about 1.46 at drive 10, full scale), so drive also adds level.'],
        noExternalModulation
    ),

    // ── FM ─────────────────────────────────────────────────────────────────
    fmAlgorithm: parameterGuidance(
        'FM operator routing',
        'Selects 0 stack 4→3→2→1, 1 pairs, 2 Y, 3 all carriers, 4 fork, 5–6 with fixed operator-4 feedback, 7 a pair plus two carriers; 0–2 have at most two carriers and no fixed feedback.',
        0,
        2,
        ['Decides which of fmLevel1 to fmLevel4 are volumes or depths, and rebuilds the routing fmModAmount scales.'],
        ['Algorithm 3 sums all four operators, 2.6 at default levels.'],
        noExternalModulation
    ),
    fmRatio1: parameterGuidance(
        'Operator 1 frequency ratio',
        'Sets operator 1’s frequency multiple; it is a carrier in every algorithm, so 0.5 is an octave down and 4 two up.',
        0.5,
        4,
        ['Ratios against fmRatio2 to fmRatio4 decide whether sidebands are harmonic.'],
        ['A non-integer ratio moves the sounding pitch off the note.'],
        noExternalModulation
    ),
    fmRatio2: parameterGuidance(
        'Operator 2 frequency ratio',
        'Sets operator 2’s multiple; it modulates operator 1 in every algorithm but 3, where it is a carrier.',
        0.5,
        8,
        ['fmLevel2 and fmModAmount set its depth.'],
        ['Operators are unband-limited sines, so high ratios push sidebands of upper notes past Nyquist.'],
        noExternalModulation
    ),
    fmRatio3: parameterGuidance(
        'Operator 3 frequency ratio',
        'Sets operator 3’s multiple: a modulator in algorithms 0, 2, 4, 5 and 6, a carrier in 1, 3 and 7.',
        0.5,
        8,
        ['fmLevel3 scales it; as a carrier its ratio against fmRatio1 sets an interval.'],
        ['As a carrier a non-integer ratio adds a second, inharmonic pitch.'],
        noExternalModulation
    ),
    fmRatio4: parameterGuidance(
        'Operator 4 frequency ratio',
        'Sets operator 4’s multiple: the top modulator in algorithms 0, 1, 2, 4 and 6, a carrier in 3, 5 and 7.',
        0.5,
        8,
        ['fmLevel4 scales it; algorithms 5 and 6 add fixed self-feedback of 0.5 or 0.7.'],
        ['As a carrier a non-integer ratio sounds as a separate inharmonic tone.'],
        noExternalModulation
    ),
    fmLevel1: parameterGuidance(
        'Operator 1 output level',
        'Scales operator 1, a carrier in all eight algorithms, so it is always a volume.',
        0.5,
        1,
        ['fmFeedback multiplies this operator’s output, so fmLevel1 also scales the feedback.'],
        ['At 0 algorithms 0, 2, 4 and 6 go silent.'],
        noExternalModulation
    ),
    fmLevel2: parameterGuidance(
        'Operator 2 level (mostly modulation depth)',
        'Scales operator 2; as a modulator its depth is level × fmModAmount × 2π rad, so at fmModAmount 1, 0.1 to 0.8 is about 0.6 to 5 rad.',
        0.1,
        0.8,
        ['fmModAmount multiplies its depth; in algorithm 3 it is a volume.'],
        ['With unband-limited operators, high depths push sidebands of high notes past Nyquist.'],
        noExternalModulation
    ),
    fmLevel3: parameterGuidance(
        'Operator 3 level',
        'Scales operator 3: a depth in algorithms 0, 2, 4, 5 and 6, a volume in 1, 3 and 7.',
        0,
        0.6,
        ['fmAlgorithm sets its role; fmModAmount scales it only as a modulator.'],
        ['Changing fmAlgorithm can turn the same value from a depth into a volume.'],
        noExternalModulation
    ),
    fmLevel4: parameterGuidance(
        'Operator 4 level',
        'Scales operator 4: the top modulator in algorithms 0, 1, 2, 4 and 6, a volume in 3, 5 and 7.',
        0,
        0.5,
        ['fmRatio4 sets its frequency; in algorithms 5 and 6 its fixed self-feedback scales with it.'],
        ['In algorithms 3, 5 and 7 the low default becomes an output volume.'],
        noExternalModulation
    ),
    fmFeedback: parameterGuidance(
        'Operator 1 self-feedback',
        'Feeds operator 1’s previous output back into its phase, in radians scaled by its level; operator 4’s fixed feedback is separate.',
        0,
        0.5,
        ['fmLevel1 scales what is fed back.'],
        ['Operator 1 is a carrier in every algorithm, so the feedback always reaches the output.'],
        noExternalModulation
    ),
    fmModAmount: parameterGuidance(
        'Global FM modulation depth',
        'Rescales every active routing to this amount; keep it above 0, which latches the routing off.',
        0.25,
        2,
        ['Multiplies the depths of fmLevel2, fmLevel3 and fmLevel4 wherever they modulate.'],
        [
            'At 0 each voice configured then loses its routing, and raising fmModAmount restores none until fmAlgorithm changes.',
        ],
        noExternalModulation
    ),
};
