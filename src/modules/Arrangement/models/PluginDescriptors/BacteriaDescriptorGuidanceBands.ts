import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Bacteria's global level, crossover, distortion,
 * filter and band-gain controls, taken from `crates/daw-dsp/src/bacteria`.
 *
 * Facts the entries rely on and the descriptor cannot say itself: every id
 * here is a bare name, which the engine broadcasts to all six bands, so no
 * descriptor write can voice one band differently from another; each effect
 * stage (distortion, filter, chorus, phaser, granular, spectral, frequency
 * shifter, lo-fi, convolution) starts switched off per band and has no
 * descriptor enable parameter, so a module control is inaudible until the stage
 * is switched on in the Bacteria panel; and the global routing mode is not a
 * descriptor parameter either, with the engine defaulting to Parallel and the
 * panel's default patch choosing Serial. The effect-stage controls live in the
 * companion file, and the modulation sources in a third.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

/**
 * One crossover corner. The five corners share the same engine arm, ordering
 * rule and routing gate, and differ only in which neighbours they push and the
 * range each musically occupies.
 */
function crossoverCorner(point: number, minimum: number, maximum: number): DeviceParameterGuidance {
    const neighbours = [point > 1 ? `crossoverFreq${point - 1}` : null, point < 5 ? `crossoverFreq${point + 1}` : null]
        .filter((id): id is string => id !== null)
        .join(' and ');
    return parameterGuidance(
        `Crossover split point ${point}`,
        `Places split ${point} of the multiband crossover, deciding where band ${point - 1} ends and band ${point} begins.`,
        minimum,
        maximum,
        [
            `Splits only matter under Parallel routing with bandCount above ${point}; writing it moves ${neighbours} so the corners stay in ascending order, and crossoverSlope sets how steeply the bands separate at this corner.`,
        ],
        [
            `Split ${point} shapes nothing under Serial or Mid/Side routing and nothing until bandCount exceeds ${point}, so moving it can read as a dead control; in linear-phase crossoverMode a corner far below a few hundred hertz is poorly isolated by the 127-tap filters.`,
        ],
        noExternalModulation
    );
}

export const BACTERIA_BANDS_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    mix: parameterGuidance(
        'Device wet and dry mix',
        'Blends the processed sound against the untouched source, from subtle seasoning to fully transformed.',
        0.3,
        1,
        [
            'The dry copy is held back by the reported latency (oversampler, linear-phase crossover, Smudge, spectral and codec windows) so partial mixes stay time-aligned; inputGain and outputGain scale only the wet side, so the balance moves when either changes.',
        ],
        [
            'At 1 the dry source is gone and any stage with latency is heard as delay rather than as a blend, and at 0 the device is inaudible whatever its other controls say.',
        ],
        noExternalModulation
    ),
    inputGain: parameterGuidance(
        'Wet path input trim',
        'Sets how hard the effect stages are driven, without changing the dry level.',
        -6,
        6,
        [
            'Applied before the crossover and before every nonlinear stage, so it multiplies with drive; the filter envelope follower and the modulation envelope also read this level, and mix balances the result against the unscaled dry.',
        ],
        [
            'Each +6 dB doubles the level into the distortion, filter envelope and lo-fi stages, which changes their character and not just their loudness, and +24 dB is a 15.8x multiplier into every nonlinear stage.',
        ],
        noExternalModulation
    ),
    outputGain: parameterGuidance(
        'Wet path output trim',
        'Matches the level of the processed sound to the source after the effects have shaped it.',
        -6,
        6,
        [
            'Applied to the summed bands after every stage and before mix, so it scales the wet side only; gain sets a per-band trim ahead of it and inputGain sets the drive into the stages.',
        ],
        [
            'Because the dry copy ignores it, changing it also changes the wet and dry balance, and a positive trim used to offset heavy drive can push the wet side above the dry.',
        ],
        noExternalModulation
    ),
    bandCount: parameterGuidance(
        'Active band count',
        'Chooses how many bands the sound is split into, from one full-range chain to six.',
        1,
        3,
        [
            'N bands use the first N-1 of crossoverFreq1 to crossoverFreq5 under Parallel routing; every descriptor control is broadcast to all bands, so under Serial routing the same chain runs once per band and drive and gain compound.',
            'crossoverSlope and crossoverMode shape the split.',
        ],
        [
            'Changing it resets every crossover filter, so it is not a click-free control, and with a linear-phase crossoverMode each added split adds 63 samples of reported latency.',
        ],
        noExternalModulation
    ),
    crossoverFreq1: crossoverCorner(1, 80, 400),
    crossoverFreq2: crossoverCorner(2, 400, 1500),
    crossoverFreq3: crossoverCorner(3, 1500, 4000),
    crossoverFreq4: crossoverCorner(4, 3500, 9000),
    crossoverFreq5: crossoverCorner(5, 8000, 16000),
    crossoverSlope: parameterGuidance(
        'Crossover slope order',
        'Sets how sharply neighbouring bands are separated, from a gentle 12 dB overlap to near-brickwall 48 dB isolation.',
        1,
        2,
        [
            'Positions 0 to 3 select 12, 24, 36 and 48 dB per octave Linkwitz-Riley splits at every corner placed by crossoverFreq1 to crossoverFreq5; crossoverMode selects an IIR or linear-phase implementation of the same prototype.',
        ],
        [
            'It has no effect under Serial or Mid/Side routing or with bandCount at 1, and steeper slopes rotate phase more in minimum-phase mode and need longer filters to isolate bands in linear-phase mode.',
        ],
        noExternalModulation
    ),
    crossoverMode: parameterGuidance(
        'Crossover phase mode',
        'Chooses a zero-latency minimum-phase split (0) or a phase-accurate linear-phase split (1).',
        0,
        0,
        [
            'Linear phase reports and delivers (bandCount - 1) x 63 samples of latency, 1.3 ms per split at 48 kHz, and mix delays the dry copy to match; crossoverSlope sets the prototype it renders.',
        ],
        [
            'The 127-tap linear-phase filters cannot resolve corners much below a few hundred hertz, so crossoverFreq1 near 80 Hz is poorly isolated, and the delay is real latency that the host must compensate.',
        ],
        noExternalModulation
    ),
    distortionMode: parameterGuidance(
        'Distortion algorithm selector',
        'Chooses the waveshaper: soft clip (0), hard clip (1), foldback (2), wavefold (3), bitcrush (4), tube (5), breakdown (6), smudge (7) or custom (8).',
        0,
        5,
        [
            'drive and asymmetry apply to every mode; foldbackThreshold is read only in foldback, and bitDepth and sampleRateReduce only in bitcrush, where they are shared with the lo-fi stage.',
        ],
        [
            'Breakdown (6) and custom (8) currently render as plain soft clip, and smudge (7) adds a 2048-sample spectral window of delay, divided by the oversampling factor, so changing mode can change the reported latency.',
        ],
        noExternalModulation
    ),
    drive: parameterGuidance(
        'Distortion drive amount',
        'Sets how hard the band is pushed into the chosen waveshaper, from clean warmth to heavy saturation.',
        10,
        50,
        [
            'Multiplies the signal by 1 + 0.2 x drive before the shaper (6x at the default) and divides the result by the same factor afterwards; inputGain multiplies with it, and distortionMode and asymmetry decide how it is shaped.',
        ],
        [
            'Because of that division, clipped peaks come out at about 1/(1 + 0.2 x drive), 0.17 at the default and 0.05 at 100, so raising drive makes loud peaks quieter while the average level changes much less.',
        ],
        noExternalModulation
    ),
    asymmetry: parameterGuidance(
        'Distortion polarity asymmetry',
        'Adds even-harmonic warmth by treating positive and negative swings differently.',
        -0.4,
        0.4,
        [
            'Applied after the shaper by scaling the positive half by 1 + asymmetry/2 and the negative half by 1 - asymmetry/2, and skipped within 0.001 of zero; drive decides how much signal the clipper has already flattened.',
        ],
        [
            'At +-1 one polarity is 1.5x and the other 0.5x, which adds a DC offset and a lopsided waveform that costs headroom for the stages after it.',
        ],
        noExternalModulation
    ),
    foldbackThreshold: parameterGuidance(
        'Foldback fold threshold',
        'Sets the level at which foldback distortion mirrors the signal back, so lower values fold sooner and sound harsher.',
        0.3,
        0.9,
        [
            'Read only in foldback (distortionMode 2) and applied to the driven signal, so drive controls how far over the threshold the signal travels.',
        ],
        [
            'It mirrors once at the threshold and does not fold repeatedly, so at high drive the output keeps moving away from the threshold instead of staying inside it.',
        ],
        noExternalModulation
    ),
    bitDepth: parameterGuidance(
        'Quantiser bit depth',
        'Rounds the signal to fewer amplitude steps for a gritty, digital crunch.',
        4,
        16,
        [
            'Read by the bitcrush distortion mode and by the lo-fi stage, which share it, so moving it changes both; sampleRateReduce adds time-domain crunch and lofiAmount scales how far the lo-fi stage is taken toward this depth.',
        ],
        [
            'At the default 16 bits the quantisation is below audibility, and values under about 6 bits add obvious quantisation noise.',
        ],
        noExternalModulation
    ),
    sampleRateReduce: parameterGuidance(
        'Sample-hold divider',
        'Holds each sample for several samples, lowering the effective sample rate for a metallic, aliased grit.',
        1,
        8,
        [
            'Shared by the bitcrush distortion mode and the lo-fi stage, whose divider applies at full strength once lofiAmount or codecArtifact is above zero; bitDepth sets the amplitude resolution beside it.',
        ],
        [
            'There is no anti-alias filter, so a divider above about 8 folds content above one sixteenth of the sample rate back into the audible range as inharmonic aliasing.',
        ],
        noExternalModulation
    ),
    breakdownDepth: parameterGuidance(
        'Breakdown pitch-drop depth',
        'Intended to set how many octaves the breakdown mode drops the pitch.',
        0.5,
        2,
        [
            'Meant for distortionMode 6, but the breakdown processor is not implemented and that mode renders as soft clip driven by drive, so this value is stored and never read.',
        ],
        ['Changing it has no audible effect, so a recipe that relies on it for a pitch drop will silently do nothing.'],
        noExternalModulation
    ),
    filterMode: parameterGuidance(
        'Filter response type',
        'Chooses low-pass (0), high-pass (1), band-pass (2), notch (3), formant (4) or comb (5).',
        0,
        3,
        [
            'filterCutoff and filterResonance mean different things in the comb mode, where cutoff sets the comb fundamental and resonance sets feedback instead of Q; formant doubles the band-pass level.',
        ],
        [
            'Formant is a band-pass at twice the level, which adds 6 dB, and comb mode is a delay loop that can ring forever at full resonance, so switching mode during a note changes level and stability together.',
        ],
        noExternalModulation
    ),
    filterCutoff: parameterGuidance(
        'Filter cutoff frequency',
        'Sets where the filter acts, from dark and muffled at low values to open and bright.',
        200,
        12000,
        [
            'In comb mode it sets the comb fundamental (the delay is the sample rate divided by this, limited to 50 ms); filterEnvAmount multiplies it by 1 + amount x level x 4 and any modulation offsets add to it before the 20 Hz to 20 kHz clamp.',
            'filterResonance sets the peak.',
        ],
        [
            'The effective cutoff can differ from the knob because the envelope term can raise it up to 5x or push it to the 20 Hz floor, so an apparently open setting can be closed by the signal itself.',
        ],
        noExternalModulation
    ),
    filterResonance: parameterGuidance(
        'Filter resonance peak',
        'Adds an emphasised peak at the cutoff, from gentle to whistling.',
        0.1,
        0.6,
        [
            'Sets Q = 1 / (2 - 1.98 x resonance): 0.71 at the default 0.3, 1.0 at 0.5, 2.4 at 0.8 and 50 at 1, and in comb mode it is the feedback gain instead; filterCutoff decides where the peak sits.',
        ],
        [
            'Near 1 the low-pass and band-pass peak reaches about +34 dB, and in comb mode a value of 1 makes the loop gain unity so the delay line rings indefinitely.',
        ],
        noExternalModulation
    ),
    filterEnvAmount: parameterGuidance(
        'Filter envelope follower amount',
        'Makes the filter open with louder playing (positive) or close with it (negative), an auto-wah effect.',
        -0.2,
        0.5,
        [
            'Multiplies filterCutoff by 1 + amount x level x 4, where level is the rectified band signal followed with a 5 ms attack and 200 ms release; inputGain changes the level it follows.',
        ],
        [
            'A negative amount on loud material drives the cutoff multiplier below zero, which clamps to the 20 Hz floor and closes the filter completely, and a large positive amount multiplies the cutoff up to 5x.',
        ],
        noExternalModulation
    ),
    gain: parameterGuidance(
        'Band gain trim',
        'Raises or lowers the level of each band after its effects, like a per-band fader.',
        -6,
        6,
        [
            'Applied after every stage in the band and before the bands are summed, with a 5 ms smoothing; outputGain trims the sum and mix balances it against the dry copy.',
        ],
        [
            'The bare id is broadcast to every band, so it cannot balance one band against another, and under Serial routing it is applied once per band, so the gain compounds (a +6 dB setting becomes +12 dB across two bands and +18 dB across three).',
        ],
        noExternalModulation
    ),
};
