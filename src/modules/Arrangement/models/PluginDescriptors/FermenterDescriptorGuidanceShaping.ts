import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Fermenter's per-voice shaping — filter,
 * amplitude and filter envelopes, LFO, MSEG and step-sequencer routes, glide
 * and chaotic modulation — taken from `crates/daw-dsp/src/fermenter`
 * (`voice.rs`, `filter.rs`, `envelope.rs`, `lfo.rs`, `modulation.rs`,
 * `mseg.rs`, `stepseq.rs`, `chaos.rs`, `layer.rs`). The cutoff each sample is
 * `filterCutoff × keytracking × (1 + 4·filter env·filterEnvAmount +
 * 2·LFO·lfoFilterAmount + 4·MSEG·msegToFilter + audio-rate and chaos terms)`,
 * clamped to 20 Hz–20 kHz. Envelopes are one-pole stages whose time
 * parameters are time constants. Every id here is per layer. The text stays
 * terse so each eight-parameter manifest page fits one tool receipt.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const FERMENTER_SHAPING_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    // ── Filter ─────────────────────────────────────────────────────────────
    filterModel: parameterGuidance(
        'Filter model selector',
        'Selects 0 state-variable, 1 ladder low-pass, 2 diode low-pass, 3 vowel formant, 4 high-pass into low-pass, 5 morphing state-variable.',
        0,
        2,
        ['Only models 0 and 5 read filterMode.'],
        ['A resonance set on model 0 can land at model 2’s maximum feedback or model 5’s zero damping.'],
        noExternalModulation
    ),
    filterCutoff: parameterGuidance(
        'Filter cutoff frequency',
        'Base cutoff every modulation multiplies, clamped to 20 Hz–20 kHz; the default envelope peak triples it, hitting the clamp above about 6.6 kHz.',
        100,
        6500,
        ['filterEnvAmount, lfoFilterAmount, msegToFilter, filterKeytrack and chaosAmount scale it.'],
        ['On model 3, 0–5 kHz maps onto vowels A to U; above 5 kHz the vowel stays fixed.'],
        noExternalModulation
    ),
    filterResonance: parameterGuidance(
        'Filter resonance',
        'Is Q on model 0, feedback 0–4 on 1, feedback 0–1 ×17 on 2, a bandwidth divisor on 3, √Q per section on 4, and damping 2 − value on 5.',
        0.7,
        4,
        ['filterModel decides which scale applies.'],
        ['Model 2 is at full feedback from 1 up; model 5 has no damping from 2 up.'],
        noExternalModulation
    ),
    filterMode: parameterGuidance(
        'Filter response',
        'Selects 0 low-pass, 1 high-pass, 2 band-pass or 3 notch on model 0; model 5 morphs instead.',
        0,
        2,
        ['Read only when filterModel is 0 or 5.'],
        ['On model 5, index 1 is a low-pass and notch blend and index 3 is a pure high-pass.'],
        noExternalModulation
    ),
    filterDrive: parameterGuidance(
        'Filter saturation drive',
        'Drives a rational tanh by 1 + drive, after the filter on model 0 and before it elsewhere; up to 2 a full-scale signal lands at its knee.',
        0,
        2,
        ['voiceDrive saturates again after it.'],
        ['The two ladder models saturate their input even at 0 drive.'],
        noExternalModulation
    ),
    filterKeytrack: parameterGuidance(
        'Cutoff keyboard tracking',
        'Multiplies the cutoff by 2^((note − 60)/12 × keytrack); from a 5 kHz base, 0.5 reaches the 20 kHz clamp at C8 and 1 at C6.',
        0,
        0.5,
        ['Scales filterCutoff before every modulation.'],
        ['At 1 the cutoff falls proportionally for notes below middle C.'],
        noExternalModulation
    ),
    filterEnvAmount: parameterGuidance(
        'Filter envelope amount',
        'Multiplies the cutoff by 1 + 4 × envelope × amount: 0.5 triples the peak, −0.25 brings it to zero.',
        -0.25,
        0.5,
        ['It scales the envelope filterAttack to filterRelease shape.'],
        ['Below −0.25 the peak multiplier is negative and the cutoff pins to 20 Hz.'],
        noExternalModulation
    ),

    // ── Amp envelope ───────────────────────────────────────────────────────
    ampAttack: parameterGuidance(
        'Amplitude attack time constant',
        'Rises with ampAttack as time constant (63 % after one, 95 % after three) and hands to decay at 0.999, about 6.9 × ampAttack.',
        0.001,
        0.3,
        ['ampDecay starts only once the attack reaches 0.999.'],
        ['A 0.3 s setting takes about 2 s to finish the attack.'],
        noExternalModulation
    ),
    ampDecay: parameterGuidance(
        'Amplitude decay time constant',
        'Falls from the peak toward ampSustain with ampDecay as time constant.',
        0.05,
        1,
        ['Has no effect when ampSustain is 1.'],
        ['With ampSustain at 0 the decay is the whole note.'],
        noExternalModulation
    ),
    ampSustain: parameterGuidance(
        'Amplitude sustain level',
        'Sets the linear level held while the key is down; 0.5 is −6 dB.',
        0.4,
        1,
        ['ampDecay falls to it; ampRelease starts from it.'],
        ['At 0 a held voice stays allocated while silent, using polyphony.'],
        noExternalModulation
    ),
    ampRelease: parameterGuidance(
        'Amplitude release time constant',
        'Falls from the note-off level with ampRelease as time constant; the voice stays allocated until below 1e−8, about 18 × ampRelease from full level.',
        0.02,
        1.5,
        ['Ends the voice on every engine, cutting a longer filterRelease; it is also the tail length.'],
        ['From full level at 1.5 s a voice stays allocated about 28 s, so fast passages start stealing voices.'],
        noExternalModulation
    ),

    // ── Filter envelope ───────────────────────────────────────────────────
    filterAttack: parameterGuidance(
        'Filter envelope attack time constant',
        'Rises toward 1 with filterAttack as time constant.',
        0.001,
        0.5,
        ['Heard only when filterEnvAmount is not 0.'],
        ['With filterEnvAmount at 0 the filter envelope is ignored.'],
        noExternalModulation
    ),
    filterDecay: parameterGuidance(
        'Filter envelope decay time constant',
        'Falls from the peak toward filterSustain with filterDecay as time constant.',
        0.05,
        2,
        ['filterEnvAmount turns the fall into a cutoff sweep.'],
        ['Short decays with a large filterEnvAmount make a brief cutoff spike at each note-on.'],
        noExternalModulation
    ),
    filterSustain: parameterGuidance(
        'Filter envelope sustain level',
        'Sets the envelope level held while the key is down; at the default filterEnvAmount, 0.5 holds twice the base cutoff.',
        0,
        0.5,
        ['Multiplied by filterEnvAmount into the cutoff multiplier.'],
        ['At 1 the cutoff holds the envelope peak for the whole note.'],
        noExternalModulation
    ),
    filterRelease: parameterGuidance(
        'Filter envelope release time constant',
        'Falls after note-off with filterRelease as time constant, back toward the base cutoff.',
        0.02,
        1.5,
        ['The voice ends with the amp envelope, so values beyond ampRelease are cut off.'],
        ['A short filter release under a long ampRelease leaves the tail at the base cutoff.'],
        noExternalModulation
    ),

    // ── LFO and modulation routes ─────────────────────────────────────────
    lfoRate: parameterGuidance(
        'Per-voice LFO rate',
        'Sets the LFO from 0 to 5000 Hz; it restarts each note-on, and at 0 its phase never moves.',
        0,
        10,
        ['Heard only through lfoPitchAmount or lfoFilterAmount.'],
        ['At 0 triangle and saw hold −1 and square +1, applying a fixed offset; sine holds 0.'],
        noExternalModulation
    ),
    lfoShape: parameterGuidance(
        'LFO waveform',
        'Selects 0 sine, 1 triangle, 2 saw or 3 square; saw and square jump once or twice per cycle.',
        0,
        1,
        ['Shapes what lfoPitchAmount and lfoFilterAmount apply at lfoRate.'],
        ['Saw and square jumps are not smoothed, so pitch or cutoff steps each cycle.'],
        noExternalModulation
    ),
    lfoPitchAmount: parameterGuidance(
        'LFO to pitch amount in octaves',
        'Adds LFO × amount octaves to pitch: ±0.05 is ±60 cents and ±1 a full octave.',
        -0.05,
        0.05,
        ['lfoRate sets the speed; at audio rates it becomes frequency modulation.'],
        ['The unit is octaves, so 0.25 already swings a minor third.'],
        noExternalModulation
    ),
    lfoFilterAmount: parameterGuidance(
        'LFO to cutoff amount',
        'Adds 2 × LFO × amount to the cutoff multiplier; ±0.4 swings 0.2 to 1.8 times the cutoff.',
        -0.4,
        0.4,
        ['Adds to filterEnvAmount and msegToFilter in one multiplier.'],
        ['From ±0.5 the trough pins the cutoff to 20 Hz.'],
        noExternalModulation
    ),
    msegToFilter: parameterGuidance(
        'MSEG to cutoff amount',
        'Adds 4 × MSEG × amount to the cutoff multiplier; the MSEG is fixed: 1 in 10 ms, 0.7 after 0.2 s, held, 0 over 0.3 s.',
        -0.25,
        0.5,
        ['Adds to filterEnvAmount and lfoFilterAmount in one multiplier.'],
        ['Below −0.25 the multiplier crosses zero at the MSEG peak.'],
        noExternalModulation
    ),
    seqRate: parameterGuidance(
        'Step-sequencer step rate',
        'Advances the fixed pattern seqRate steps per second, not tempo-synced; it alternates two values each step.',
        1,
        8,
        ['Heard only when seqToPitch is not 0.'],
        ['Its Hz rate ignores the project tempo, so steps drift against the grid.'],
        noExternalModulation
    ),
    seqToPitch: parameterGuidance(
        'Step sequencer to pitch amount',
        'Moves pitch between ±0.6 × amount octaves on alternate steps, spanning 1.2 × amount; 0.8333 spans an octave.',
        0,
        0.8333,
        ['seqRate sets the step rate.'],
        ['Any non-zero amount makes every note alternate between two pitches.'],
        noExternalModulation
    ),

    // ── Glide ──────────────────────────────────────────────────────────────
    portamentoTime: parameterGuidance(
        'Glide time',
        'Glides from the last played pitch, about 99.8 % complete after portamentoTime; 0.001 s or less snaps.',
        0,
        0.3,
        ['portamentoMode decides whether every note glides.'],
        ['In always mode each chord note glides from the note entered before it.'],
        noExternalModulation
    ),
    portamentoMode: parameterGuidance(
        'Glide mode: always or legato',
        'Selects 0 to glide every note, or 1 to glide only while a key is still held and snap after a rest.',
        1,
        1,
        ['Has no effect while portamentoTime is 0.'],
        ['Legato reads key state, so overlapped notes glide and detached ones snap.'],
        noExternalModulation
    ),

    // ── Chaos ──────────────────────────────────────────────────────────────
    chaosAmount: parameterGuidance(
        'Chaotic modulation amount',
        'Scales a Lorenz pitch drift of ±0.1 × amount octaves, a Lorenz cutoff term of ±0.5 × amount and a Perlin gain of ±0.3 × amount.',
        0,
        0.3,
        ['chaosSpeed sets their speed; the cutoff term adds to the filterCutoff multiplier.'],
        ['The Lorenz part restarts identically on every note.'],
        noExternalModulation
    ),
    chaosSpeed: parameterGuidance(
        'Chaotic modulation speed',
        'Sets the Lorenz step (speed × 0.0001 per sample) and the Perlin rate, a new target every 1/speed s.',
        0.1,
        3,
        ['Heard only when chaosAmount is above 0.001.'],
        ['The Lorenz step is per sample, so it runs faster at higher sample rates.'],
        noExternalModulation
    ),
};
