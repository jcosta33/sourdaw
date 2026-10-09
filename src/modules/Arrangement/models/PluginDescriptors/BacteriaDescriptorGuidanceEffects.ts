import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Bacteria's modulation-effect, granular, spectral,
 * frequency-shift, lo-fi and convolution stages, taken from
 * `crates/daw-dsp/src/bacteria`.
 *
 * Every stage here starts switched off per band and has no descriptor enable
 * parameter, so each entry is inaudible until the stage is switched on in the
 * Bacteria panel; the convolution stage additionally needs a body impulse
 * response chosen there, and passes audio through unchanged until one is
 * loaded. Stages run in this order inside a band: distortion, filter, chorus,
 * phaser, granular, spectral, frequency shifter, lo-fi, convolution, then the
 * band gain.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const BACTERIA_EFFECTS_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    chorusRate: parameterGuidance(
        'Chorus modulation rate',
        'Sets how fast the chorus delay sweeps, from slow ensemble drift to a wobbling vibrato.',
        0.2,
        4,
        [
            'The delay swings by chorusDepth x 3.5 ms around a 7 ms base, so the peak pitch deviation is 2 pi x rate x depth x 3.5 ms, 1.3 percent at the defaults; chorusFeedback and chorusMix decide how much of that swing is heard.',
        ],
        [
            'Above about 5 Hz the sweep reads as vibrato instead of chorus, and the left and right channels sweep 90 degrees apart, so fast rates make the stereo image shimmer.',
        ],
        noExternalModulation
    ),
    chorusDepth: parameterGuidance(
        'Chorus delay swing depth',
        'Sets how far the chorus delay moves, from a subtle thickening to seasick pitch bends.',
        0.2,
        0.7,
        [
            'Swing is depth x 3.5 ms either side of the 7 ms base delay and chorusRate sets how fast it is traversed; chorusFeedback recirculates the moving delay and chorusMix sets the proportion heard.',
        ],
        [
            'Large depth with a fast chorusRate produces large pitch deviations on sustained notes, which sounds detuned rather than doubled.',
        ],
        noExternalModulation
    ),
    chorusFeedback: parameterGuidance(
        'Chorus delay feedback',
        'Recirculates the chorus output for a flanger-like comb, positive for a bright ring and negative for a hollow one.',
        -0.3,
        0.4,
        [
            'Clamped to +-0.95 inside the engine; the loop is a delay of about 7 ms, so its comb peaks fall every 143 Hz, and chorusDepth moves them while chorusMix sets how much of the loop is heard.',
        ],
        [
            'The loop gain 1/(1 - |feedback|) reaches +26 dB at the 0.95 clamp, so strong settings ring at comb peaks and can overload the following stage.',
        ],
        noExternalModulation
    ),
    chorusMix: parameterGuidance(
        'Chorus wet and dry mix',
        'Blends the delayed, modulated copy with the direct signal.',
        0.2,
        0.6,
        [
            'The wet signal is the delayed copy only, so at 0.5 the delayed and direct signals form a comb whose first notch is near 71 Hz; chorusDepth moves the notches and chorusFeedback deepens them.',
        ],
        [
            'At 1 only the delayed signal remains, which loses the direct attack of every note, and near 0.5 the fixed 7 ms delay thins the low end through its comb.',
        ],
        noExternalModulation
    ),
    phaserRate: parameterGuidance(
        'Phaser sweep rate',
        'Sets how fast the phaser notches sweep up and down the spectrum.',
        0.1,
        2,
        [
            'Drives one sweep of six all-pass stages between 200 Hz and 200 Hz + 3.8 kHz x phaserDepth; phaserFeedback sharpens the notches and phaserMix sets their depth.',
        ],
        ['Rates above about 4 Hz turn the sweep into a warble that smears pitch instead of a phaser sweep.'],
        noExternalModulation
    ),
    phaserDepth: parameterGuidance(
        'Phaser sweep width',
        'Sets how high the phaser notches rise, from a narrow low sweep to a wide one.',
        0.4,
        0.9,
        [
            'The all-pass frequency is 200 Hz + 3800 Hz x LFO x depth, so it never goes below 200 Hz and reaches 4 kHz at 1; phaserRate sets how often it traverses that range.',
        ],
        ['At 0 the all-pass stays parked at 200 Hz and the effect becomes a static filter instead of a sweep.'],
        noExternalModulation
    ),
    phaserFeedback: parameterGuidance(
        'Phaser notch resonance',
        'Sharpens the phaser notches and peaks, positive for a bright ring and negative for a hollow one.',
        -0.7,
        0.7,
        [
            'Clamped to +-0.95 inside the engine and fed back through all six all-pass stages; phaserMix decides how much of the resonant signal is heard.',
        ],
        [
            'Peak gain follows 1/(1 - |feedback|), +26 dB at the clamp, so high settings ring loudly where the stages fall in phase.',
        ],
        noExternalModulation
    ),
    phaserMix: parameterGuidance(
        'Phaser wet and dry mix',
        'Blends the all-passed signal with the direct signal, which is what creates the notches.',
        0.3,
        0.7,
        [
            'The all-pass signal has unity level and only rotates phase, so notches appear only when it is blended with the direct signal; phaserFeedback adds resonance on top.',
        ],
        [
            'At 1 the notches vanish because only the all-pass signal is heard, which leaves a phase rotation and whatever phaserFeedback adds.',
        ],
        noExternalModulation
    ),
    grainSize: parameterGuidance(
        'Grain length',
        'Sets how long each audio grain lasts, from clicky micro-grains to smooth overlapping texture.',
        30,
        200,
        [
            'Grains are summed without level normalisation, so grainSize x grainDensity is the average number of overlapping grains (1.2 at the defaults) and level grows with it; grainPosOffset and grainPitch limit how long a grain can run.',
        ],
        [
            'Under about 20 ms grains are shorter than the period of low notes, which chops them into buzzing fragments, and with grainDensity high an overlap above 2 or 3 makes the stage much louder than its input.',
        ],
        noExternalModulation
    ),
    grainDensity: parameterGuidance(
        'Grain spawn rate',
        'Sets how many grains start per second, from sparse stuttering to a dense cloud.',
        5,
        40,
        [
            'Each grain is spawned from a fixed pool of 64, so overlap is bounded by it; grainSize sets how long they last, grainPosOffset where they read from, and grainMix how much cloud is heard.',
        ],
        [
            'High density with long grains stacks overlapping, unnormalised grains and builds level, and very low density leaves audible gaps between short grains.',
        ],
        noExternalModulation
    ),
    grainPosOffset: parameterGuidance(
        'Grain read position behind live',
        'Sets how far back in the recent past the grains read, from live audio to a delayed echo of the last two seconds.',
        20,
        500,
        [
            'Grains start this many milliseconds behind the input from a 2 second ring, so the wet cloud is delayed by about this amount, and that delay is not reported as device latency; grainPitch above 0 shortens grains when the read head would catch the live edge.',
        ],
        [
            'At 0 ms with a positive grainPitch each grain is limited to a single sample because its read head immediately reaches the live edge, so the cloud goes almost silent.',
        ],
        noExternalModulation
    ),
    grainPitch: parameterGuidance(
        'Grain pitch shift',
        'Transposes each grain by resampling it, from octave-down drones to shimmering octave-up clouds.',
        -7,
        7,
        [
            'Pitch ratio is 2^(semitones/12) applied by changing the read speed, so grain length and timing are unchanged; upward shifts make the read head approach the live edge, so grainPosOffset must leave room for them.',
        ],
        [
            'Upward shifts with a small grainPosOffset cut grains short, with a positive shift of 12 and 100 ms of offset limiting each grain to 100 ms, and downward shifts only cut grains short when the offset approaches the 2 second ring size.',
        ],
        noExternalModulation
    ),
    grainMix: parameterGuidance(
        'Granular wet and dry mix',
        'Blends the grain cloud with the direct signal.',
        0.2,
        0.7,
        [
            'The dry signal is the live input while the grains come from grainPosOffset behind it; grainSize and grainDensity decide the cloud level that is balanced against it.',
        ],
        [
            'At 1 the live input is removed and everything heard is delayed material, so the stage can sound late and, with high overlap, louder than the source.',
        ],
        noExternalModulation
    ),
    spectralBlur: parameterGuidance(
        'Spectral blur amount',
        'Smears the spectrum over time, from a faint softening of transients to a sustained wash.',
        0.3,
        0.9,
        [
            'Smooths each frequency magnitude across 2048-point frames hopped every 512 samples with a coefficient of this value, a time constant of roughly 10.7 ms / (1 - blur) at 48 kHz for values above about 0.8; spectralMix sets how much of the smear is heard.',
        ],
        [
            'Values near 1 are clamped to 0.999 and smooth over seconds, so new material barely registers, and the stage reports 2048 samples (about 43 ms at 48 kHz) of latency whenever it is on.',
        ],
        noExternalModulation
    ),
    spectralMix: parameterGuidance(
        'Spectral wet and dry mix',
        'Blends the blurred spectrum with the direct signal.',
        0.3,
        0.8,
        [
            'The dry copy is delayed by the same 2048-sample window as the blurred path, so they stay aligned at every mix; spectralBlur decides how different the blurred signal is from the dry.',
        ],
        [
            'The whole stage adds about 43 ms of delay even at 0, because the stage is in the path whenever it is on, and that delay is reported as latency, so a host that does not compensate hears the track late.',
        ],
        noExternalModulation
    ),
    freqShiftHz: parameterGuidance(
        'Frequency shift amount',
        'Moves every partial up or down by a fixed number of hertz, producing inharmonic, metallic or detuned tones.',
        -100,
        100,
        [
            'A Hilbert-transform single-sideband shifter: positive values shift up, negative down, and anything under 0.001 Hz bypasses the stage; freqShiftMix sets how much of the shifted copy is heard.',
        ],
        [
            'Components shifted past Nyquist or below 0 Hz wrap back as aliased content, and the 40 dB sideband rejection only holds from about 21 Hz to 21.6 kHz at 48 kHz, so low content leaks into the wrong sideband.',
        ],
        noExternalModulation
    ),
    freqShiftMix: parameterGuidance(
        'Frequency shift wet and dry mix',
        'Blends the shifted signal with the direct signal, from a faint detune beat to a full pitch-warp.',
        0.3,
        0.8,
        [
            'The shifted signal has unity gain, so at 0.5 the dry and shifted copies beat at the shift frequency; freqShiftHz sets that beat rate.',
        ],
        [
            'With small shifts under about 20 Hz and a mix near 0.5 the two copies beat as a phasing or tremolo, which can read as an unwanted effect rather than a shift.',
        ],
        noExternalModulation
    ),
    lofiAmount: parameterGuidance(
        'Lo-fi degradation amount',
        'Scales how far the lo-fi stage reduces bit depth, from clean to heavily crushed.',
        0,
        50,
        [
            'Effective bit depth is 24 - (amount/100) x (24 - bitDepth), so it only reaches the bitDepth setting at 100 percent; sampleRateReduce applies at full strength once amount or codecArtifact is at least 0.01.',
        ],
        [
            'At the default bitDepth of 16 even 100 percent only reaches 16 bits, which is inaudible, so audible crushing needs a lower bitDepth as well.',
        ],
        noExternalModulation
    ),
    codecArtifact: parameterGuidance(
        'Lossy codec artifact amount',
        'Simulates low-bitrate codec damage by discarding quiet spectral detail.',
        0,
        0.5,
        [
            'Transforms each channel in separate 256-sample frames, zeroes coefficients below 0.5 x this value in raw transform units, and above 0.3 also zeroes every fourth coefficient; lofiAmount and sampleRateReduce add the other lo-fi degradations.',
        ],
        [
            'Anything above 0.01 engages a 256-sample frame of delay (5.3 ms at 48 kHz), the frames do not overlap so edges can click, and above 0.3 a quarter of the coefficients are dropped whatever the exact value.',
        ],
        noExternalModulation
    ),
    convolutionMix: parameterGuidance(
        'Body convolution wet and dry mix',
        'Blends the resonant body character with the direct signal.',
        0.2,
        0.8,
        [
            'The built-in body impulse responses are normalised to unit energy, so a mix of 1 leaves white noise within 0.4 dB of its dry level; convolutionSeparation widens side content in the convolved signal, and gain trims the result afterwards.',
            'Dry and body add as a crossfade of two mostly uncorrelated signals: measured on mono white noise at 48 kHz, every built-in body lowers the level by 0.9 dB at mix 0.1, 2.0 dB at 0.25, 2.8 to 3.0 dB at 0.5 and 1.7 to 2.0 dB at 0.75.',
        ],
        [
            'Each body still lifts its own resonance by 25.7 to 26.4 dB, so material concentrated there gets louder: on mono pink noise at 48 kHz, wood (800 Hz) measures +1.7 dB at mix 0.5 and +6.3 dB at 1, while ceramic and metal stay between -1.7 and +1.9 dB at mixes 0.1, 0.25, 0.3, 0.5, 0.75 and 1.',
        ],
        noExternalModulation
    ),
    convolutionSeparation: parameterGuidance(
        'Body stereo separation',
        'Widens the convolved body sound by boosting its side content.',
        0.3,
        0.8,
        [
            'Multiplies the side signal of the convolved output by 1 + 2 x separation, up to 3x; convolutionMix decides how much of the convolved signal is heard.',
        ],
        [
            'The built-in bodies have identical left and right responses, so this only widens side content already in the input and cannot create width from a mono source.',
        ],
        noExternalModulation
    ),
};
