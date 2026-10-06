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
 * parameters are time constants. Every id here is per layer.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const FERMENTER_SHAPING_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    // ── Filter ─────────────────────────────────────────────────────────────
    filterModel: parameterGuidance(
        'Filter model selector',
        'Selects 0 state-variable multimode, 1 four-stage ladder low-pass, 2 diode ladder low-pass, 3 vowel formant, 4 high-pass into low-pass at one cutoff, or 5 morphing state-variable.',
        0,
        2,
        [
            'filterMode is read only by models 0 and 5, and filterResonance means a different scale on each model; model 3 turns filterCutoff into a vowel position.',
        ],
        [
            'Switching models changes what filterResonance and filterCutoff mean, so a resonance chosen on model 0 can land at model 2’s maximum feedback or model 5’s zero damping.',
        ],
        noExternalModulation
    ),
    filterCutoff: parameterGuidance(
        'Filter cutoff frequency',
        'Sets the base cutoff that keytracking and every modulation multiply, clamped to 20 Hz–20 kHz; with the default filterEnvAmount the envelope peak triples it, so above about 6.6 kHz that peak hits the clamp.',
        100,
        6500,
        [
            'filterEnvAmount, lfoFilterAmount, msegToFilter, filterKeytrack and chaosAmount all scale it; on filterModel 3 it maps 0 to 5 kHz onto the vowel sequence A, E, I, O, U.',
        ],
        ['On the formant model every cutoff above 5 kHz pins the same final vowel, so sweeps above it do nothing.'],
        noExternalModulation
    ),
    filterResonance: parameterGuidance(
        'Filter resonance (Q) per model',
        'Is the Q on model 0, the feedback 0 to 4 on model 1, feedback 0 to 1 scaled to 17 on model 2, a bandwidth divisor on model 3, √Q per section on model 4, and 2 − value damping on model 5.',
        0.7,
        4,
        ['filterModel decides the scale: model 1 ignores values above 4, model 2 above 1 and model 5 above 2.'],
        [
            'On model 2 every value from 1 up gives the same maximum feedback, and on model 5 values of 2 and above leave the filter with no damping at all.',
        ],
        noExternalModulation
    ),
    filterMode: parameterGuidance(
        'Filter response: low-pass, high-pass, band-pass or notch',
        'Selects 0 low-pass, 1 high-pass, 2 band-pass or 3 notch on model 0; model 5 morphs instead, from low-pass at 0 through notch blends to pure high-pass at 3.',
        0,
        2,
        ['Read only when filterModel is 0 or 5; the ladder, formant and high-into-low models ignore it.'],
        [
            'On model 5 the labels do not hold: index 1 is a low-pass and notch blend and index 3 (notch) gives a pure high-pass.',
        ],
        noExternalModulation
    ),
    filterDrive: parameterGuidance(
        'Filter saturation drive',
        'Drives a rational tanh curve by 1 + drive: after the filter on model 0, before it on the other models; up to 2 a full-scale signal lands at the curve’s knee.',
        0,
        2,
        ['voiceDrive saturates again after the filter, and oscLevel and noiseLevel set the level reaching this stage.'],
        ['The two ladder models saturate their input even at 0 drive, so they are never fully clean.'],
        noExternalModulation
    ),
    filterKeytrack: parameterGuidance(
        'Cutoff keyboard tracking',
        'Multiplies the cutoff by 2^((note − 60)/12 × keytrack); with the default 5 kHz base cutoff, 0.5 reaches the 20 kHz clamp only at C8, while 1 reaches it at C6.',
        0,
        0.5,
        ['Scales filterCutoff before every modulation, so it also moves where filterEnvAmount sweeps.'],
        ['At 1 notes below middle C get proportionally darker, which can make low notes dull against high ones.'],
        noExternalModulation
    ),
    filterEnvAmount: parameterGuidance(
        'Filter envelope to cutoff amount',
        'Multiplies the cutoff by 1 + 4 × filter envelope × amount: the default 0.5 triples it at the envelope peak, and −0.25 is the deepest amount whose peak stops at zero.',
        -0.25,
        0.5,
        [
            'filterAttack, filterDecay, filterSustain and filterRelease shape the envelope this scales against filterCutoff.',
        ],
        [
            'Below −0.25 the multiplier goes negative at the envelope peak and the cutoff pins to its 20 Hz clamp, muting a low-pass voice.',
        ],
        noExternalModulation
    ),

    // ── Amp envelope ───────────────────────────────────────────────────────
    ampAttack: parameterGuidance(
        'Amplitude attack time constant',
        'Rises exponentially with ampAttack as its time constant (63 % after ampAttack, 95 % after three times it) and hands over to decay at 0.999, about 6.9 × ampAttack.',
        0.001,
        0.3,
        ['ampDecay starts only once the attack reaches 0.999, so long attacks also postpone the decay to ampSustain.'],
        ['A 0.3 s setting already takes about 2 s to complete the attack, so longer values miss short notes entirely.'],
        noExternalModulation
    ),
    ampDecay: parameterGuidance(
        'Amplitude decay time constant',
        'Falls exponentially from the peak toward ampSustain with ampDecay as its time constant, entering sustain once within 0.001 of it.',
        0.05,
        1,
        ['Has no audible effect when ampSustain is 1, since there is nothing to decay to.'],
        ['With ampSustain at 0 the decay is the whole note, so short values make every note a click-like blip.'],
        noExternalModulation
    ),
    ampSustain: parameterGuidance(
        'Amplitude sustain level',
        'Sets the linear level held while the key is down; 0.5 is −6 dB of the attack peak.',
        0.4,
        1,
        ['ampDecay sets how fast the level falls to it, and ampRelease starts from wherever it is at note-off.'],
        ['At 0 the voice stays allocated while the key is held even though it is silent, using up polyphony.'],
        noExternalModulation
    ),
    ampRelease: parameterGuidance(
        'Amplitude release time constant',
        'Falls exponentially after note-off with ampRelease as its time constant; the voice stays allocated until the level drops below 1e−8, about 18 × ampRelease from full level.',
        0.02,
        1.5,
        [
            'Ends the voice for every engine, so filterRelease longer than this is cut short; it is also the Fermenter tail length.',
        ],
        [
            'Long releases hold voices for many seconds (about 28 s at 1.5 s), and with the shared voice ceiling fast passages begin stealing notes.',
        ],
        noExternalModulation
    ),

    // ── Filter envelope ───────────────────────────────────────────────────
    filterAttack: parameterGuidance(
        'Filter envelope attack time constant',
        'Rises exponentially toward 1 with filterAttack as its time constant, moving the cutoff by the amount filterEnvAmount sets.',
        0.001,
        0.5,
        ['Heard only when filterEnvAmount is not 0.'],
        ['With filterEnvAmount at 0 the whole filter envelope is ignored, so editing it changes nothing.'],
        noExternalModulation
    ),
    filterDecay: parameterGuidance(
        'Filter envelope decay time constant',
        'Falls exponentially from the envelope peak toward filterSustain with filterDecay as its time constant.',
        0.05,
        2,
        ['filterSustain sets where it settles; filterEnvAmount turns the fall into a cutoff sweep.'],
        ['Very short decays with a large filterEnvAmount make a sharp click-like brightness at every note-on.'],
        noExternalModulation
    ),
    filterSustain: parameterGuidance(
        'Filter envelope sustain level',
        'Sets the envelope level held while the key is down; with the default filterEnvAmount, 0.5 holds the cutoff at twice its base.',
        0,
        0.5,
        ['Multiplied by filterEnvAmount into the cutoff multiplier.'],
        [
            'At 1 with a positive amount the cutoff stays at the envelope peak for the whole note and never settles back.',
        ],
        noExternalModulation
    ),
    filterRelease: parameterGuidance(
        'Filter envelope release time constant',
        'Falls exponentially after note-off with filterRelease as its time constant, closing the cutoff back toward its base.',
        0.02,
        1.5,
        ['The voice ends when the amp envelope finishes, so values much longer than ampRelease are cut off.'],
        [
            'A short filter release under a long ampRelease leaves the release tail dark and dull rather than fading naturally.',
        ],
        noExternalModulation
    ),

    // ── LFO and modulation routes ─────────────────────────────────────────
    lfoRate: parameterGuidance(
        'Per-voice LFO rate',
        'Sets the LFO frequency from 0 to 5000 Hz; it restarts at every note-on, and at 0 its phase never moves.',
        0,
        10,
        ['Heard only through lfoPitchAmount or lfoFilterAmount; lfoShape sets its waveform.'],
        [
            'At 0 the LFO holds its start value, 0 for sine but −1 for triangle and saw and +1 for square, so those shapes apply a fixed pitch or cutoff offset.',
        ],
        noExternalModulation
    ),
    lfoShape: parameterGuidance(
        'LFO waveform',
        'Selects 0 sine, 1 triangle, 2 saw or 3 square; sine and triangle move continuously while saw and square jump once or twice per cycle.',
        0,
        1,
        ['Shapes the motion lfoPitchAmount and lfoFilterAmount apply, at the rate lfoRate sets.'],
        ['Saw and square are not smoothed, so their jumps step the pitch or cutoff abruptly each cycle.'],
        noExternalModulation
    ),
    lfoPitchAmount: parameterGuidance(
        'LFO to pitch amount in octaves',
        'Adds LFO × amount octaves to the pitch, so ±0.05 is already ±60 cents of vibrato and ±1 a full octave either way.',
        -0.05,
        0.05,
        ['lfoRate sets the vibrato speed; at audio rates this becomes frequency modulation.'],
        ['Because the unit is octaves, small-looking values such as 0.25 already swing the pitch by a minor third.'],
        noExternalModulation
    ),
    lfoFilterAmount: parameterGuidance(
        'LFO to cutoff amount',
        'Adds 2 × LFO × amount to the cutoff multiplier; ±0.4 swings the cutoff between 0.2 and 1.8 times its value, and ±0.5 reaches zero at the trough.',
        -0.4,
        0.4,
        ['Adds to filterEnvAmount and msegToFilter in the same multiplier on filterCutoff.'],
        ['From ±0.5 the trough pins the cutoff to 20 Hz, gating a low-pass voice in time with the LFO.'],
        noExternalModulation
    ),
    msegToFilter: parameterGuidance(
        'MSEG to cutoff amount',
        'Adds 4 × MSEG × amount to the cutoff multiplier; the MSEG shape is fixed (up to 1 in 10 ms, down to 0.7 over 0.2 s, held, released over 0.3 s).',
        -0.25,
        0.5,
        ['Adds to filterEnvAmount and lfoFilterAmount in the same multiplier on filterCutoff.'],
        ['Below −0.25 the multiplier crosses zero at the MSEG peak and the cutoff pins to 20 Hz.'],
        noExternalModulation
    ),
    seqRate: parameterGuidance(
        'Step-sequencer step rate',
        'Advances the fixed eight-step pattern seqRate steps per second; the pattern alternates two values, so the pitch toggles every step.',
        1,
        8,
        ['Heard only when seqToPitch is not 0; the rate is in Hz and does not follow the project tempo.'],
        ['The steps are not tempo-synced, so a sequenced pitch pattern drifts against the arrangement’s grid.'],
        noExternalModulation
    ),
    seqToPitch: parameterGuidance(
        'Step sequencer to pitch amount',
        'Moves the pitch between +0.6 and −0.6 × amount octaves on alternating steps, a span of 1.2 × amount octaves; 0.8333 makes the span exactly an octave.',
        0,
        0.8333,
        ['seqRate sets how fast the steps alternate.'],
        [
            'Negative amounts only swap which step is high, and any non-zero amount makes every note trill between two pitches.',
        ],
        noExternalModulation
    ),

    // ── Glide ──────────────────────────────────────────────────────────────
    portamentoTime: parameterGuidance(
        'Glide time',
        'Glides each note from the last played pitch with an exponential approach that is about 99.8 % complete after portamentoTime; 0.001 s and below snap.',
        0,
        0.3,
        ['portamentoMode decides whether every note glides or only notes played while a key is held.'],
        [
            'In always mode every chord note glides from the note entered before it, so block chords smear upward or downward.',
        ],
        noExternalModulation
    ),
    portamentoMode: parameterGuidance(
        'Glide mode: always or legato',
        'Selects 0 to glide every note, or 1 to glide only when a key is still held as the new note arrives and snap after a rest.',
        1,
        1,
        ['Has no effect while portamentoTime is 0.'],
        [
            'Legato mode decides from whether a key is still held, so overlapping notes in a fast passage glide while the same notes played detached snap.',
        ],
        noExternalModulation
    ),

    // ── Chaos ──────────────────────────────────────────────────────────────
    chaosAmount: parameterGuidance(
        'Chaotic modulation amount',
        'Scales three per-voice wanders: a Lorenz pitch drift up to ±0.1 × amount octaves, a Lorenz cutoff term up to ±0.5 × amount, and a Perlin tremolo of ±0.3 × amount.',
        0,
        0.3,
        ['chaosSpeed sets how fast both modulators move; the cutoff term adds to the filterCutoff multiplier.'],
        [
            'The Lorenz part restarts from the same point on every note, so its pitch and cutoff wander repeats identically note after note.',
        ],
        noExternalModulation
    ),
    chaosSpeed: parameterGuidance(
        'Chaotic modulation speed',
        'Sets the Lorenz integration step (speed × 0.0001 per sample) and the Perlin rate, which picks a new target every 1/speed seconds.',
        0.1,
        3,
        ['Heard only when chaosAmount is above 0.001.'],
        ['The Lorenz step is per sample, so the same setting wanders faster at higher sample rates.'],
        noExternalModulation
    ),
};
