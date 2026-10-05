import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for the shared compression, level, timing, stereo and
 * stage-two controls of Gluten, taken from `crates/daw-dsp/src/gluten`.
 *
 * Gluten's engine answers the device-level names itself and forwards every
 * other name to all four topology structs, each of which drops what it has no
 * arm for. The topology facts repeated below are the ones
 * `GlutenTopologyGating.ts` and `gluten_topology_param_reach.rs` pin: Opto
 * reads only threshold, limitMode and its own cell; Diode owns its release
 * through recovery and has a fixed 4 dB knee and 40 dB range; FET has a fixed
 * 3 dB knee, 60 dB range and a 2 ms attack ceiling; VCA is the only topology
 * with knee, range, auto-release and no oversampler. The sidechain filters,
 * character controls and FET and VCA voicing live in the companion file.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const GLUTEN_COMPRESSION_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    topology: parameterGuidance(
        'Compressor topology selector',
        'Chooses the compressor circuit, from clean console VCA glue to opto smoothness, FET aggression or diode-bridge colour.',
        0,
        2,
        [
            'Positions are 0 VCA, 1 Opto, 2 FET and 3 Diode; writing style also writes this, and ratio, attack, release, knee, range and autoRelease are heard by different subsets of the four, so the same values read differently after a topology change.',
            'blendTopology names the second stage that runs behind this one when blendAmount is above zero.',
        ],
        [
            'Opto ignores ratio, attack, release, knee and range, so switching to it silently strands every timing control the previous topology was using.',
        ],
        noExternalModulation
    ),
    style: parameterGuidance(
        'Style preset recall',
        'Recalls a ready-made bus voice: Glue (0), Punch (1), Smooth (2) or Pump (3).',
        0,
        2,
        [
            'Each style writes topology and a bundle of controls at once (Glue sets VCA, -18 dB threshold, 4:1, 10 ms attack and 6 dB knee; Punch sets FET at -20 dB, 8:1, 0.2 ms and 250 ms; Smooth sets Opto at -25 dB; Pump sets VCA with a 0.5 ms attack and 800 ms release and autoRelease off), so topology, threshold, ratio, attack and release all change underneath it.',
        ],
        [
            'Writing it after hand-set controls overwrites them, and writing those controls afterwards overrides the preset, so the final value of each depends on write order.',
        ],
        noExternalModulation
    ),
    amount: parameterGuidance(
        'Compression amount macro',
        'Raises threshold depth and ratio together with one control, from a gentle touch to heavy bus squeeze.',
        20,
        60,
        [
            'Maps 0 to 100 percent onto threshold -5 to -40 dB and ratio 2:1 to 8:1 (Diode caps at 6:1, Opto takes no ratio), by overwriting threshold and ratio; whichever of amount, threshold or ratio is written last wins.',
        ],
        [
            'The default 50 maps to -22.5 dB and 5:1, which differs from the separate threshold and ratio defaults of -18 dB and 4:1, so writing amount after them changes the sound even at its default.',
        ],
        noExternalModulation
    ),
    threshold: parameterGuidance(
        'Compression threshold',
        'Sets the level where compression begins, so lower values grab more of the programme.',
        -30,
        -10,
        [
            'Written to all four topologies at once; ratio, knee and range decide how steeply and how far it compresses above this, and amount also writes it.',
            'detection changes what it is compared against: the default RMS reading of a sine is 3 dB below its peak, so the same threshold bites 3 dB later than under peak detection.',
        ],
        [
            'Below about -30 dB on a loud mastered bus the compressor stays engaged through every phrase and flattens dynamics, and at 0 dB only material within the knee of full scale is compressed at all.',
        ],
        noExternalModulation
    ),
    ratio: parameterGuidance(
        'Compression ratio',
        'Sets how firmly signal above the threshold is pulled back, from gentle glue to near limiting.',
        2,
        6,
        [
            'Heard only by VCA, FET and Diode; Opto sets its own 3:1 rising toward 6:1 (10:1 in limit mode), Diode clamps to 1.5:1 through 6:1, and FET all-buttons mode replaces it with about 12:1 rising toward 18:1; threshold and range set the amount.',
        ],
        [
            'Above about 10:1 the compressor behaves as a limiter and flattens transients, and a ratio of 1:1 gives no gain reduction at all.',
        ],
        noExternalModulation
    ),
    attack: parameterGuidance(
        'Compression attack time',
        'Sets how quickly gain reduction catches a transient, so slow values keep punch and fast values round it off.',
        1,
        30,
        [
            'The VCA uses the full 0.02 to 250 ms range, FET clamps to 2 ms, Diode clamps to 0.5 to 30 ms and Opto ignores it for a fixed 10 ms cell; lookahead delays the audio but only Diode detects ahead of it, and release sets the recovery.',
        ],
        [
            'On FET anything above 2 ms and on Diode anything above 30 ms is silently shortened to the topology limit, so a long value does not behave as its number suggests.',
        ],
        noExternalModulation
    ),
    release: parameterGuidance(
        'Compression release time',
        'Sets how quickly gain recovers after a hit, so short values breathe and long values hold the squeeze.',
        100,
        600,
        [
            'Used by VCA only while autoRelease is off, always by FET, and ignored by Diode, whose recovery position sets 50, 100, 400, 800 or 1500 ms, and by Opto, whose cell memory stretches 60 ms toward 5 s.',
            'attack sets the opposite edge of the envelope.',
        ],
        [
            'Under about 50 ms on a bass-heavy bus the gain starts following low-frequency cycles, which adds distortion, and with autoRelease on (the default) the VCA ignores this value completely.',
        ],
        noExternalModulation
    ),
    knee: parameterGuidance(
        'Compression knee width',
        'Softens or sharpens the onset of compression around the threshold.',
        2,
        12,
        [
            'Heard only by the VCA; FET fixes 3 dB, Diode fixes 4 dB and Opto has no static knee, and the transition is centred on threshold so compression begins half this width below it.',
        ],
        [
            'A wide knee compresses well below the threshold, so at 30 dB it starts 15 dB under it and the threshold no longer marks where gain reduction begins.',
        ],
        noExternalModulation
    ),
    makeup: parameterGuidance(
        'Makeup gain',
        'Restores the level lost to gain reduction on the compressed signal.',
        0,
        8,
        [
            'Applied to the wet path after gain reduction and before mix, and added to the half-compensation level when autoMakeup is on; threshold and ratio set how much needs restoring.',
        ],
        [
            'Matching loudness by ear can flatter the compression, so compare at matched loudness against bypass, and +24 dB on top of autoMakeup can overload the next stage.',
        ],
        noExternalModulation
    ),
    mix: parameterGuidance(
        'Parallel dry and wet mix',
        'Blends the compressed signal against the uncompressed dry for parallel compression.',
        0.4,
        1,
        [
            'The dry copy is delayed only by lookahead, while on FET or Diode with oversampling above 1 the compressed path also carries a few samples of oversampler delay that latency_samples does not report, so partial mixes can comb-filter; makeup is applied to the compressed path before this blend.',
        ],
        [
            'At 0 the compressor is inaudible, and below 1 the uncompressed dry re-enters under the compressed body, so the audible reduction is shallower than the gain-reduction meter shows.',
        ],
        noExternalModulation
    ),
    autoMakeup: parameterGuidance(
        'Automatic makeup switch',
        'Adds half of the level the compressor takes at full scale, so loudness stays roughly steady as settings change.',
        0,
        0,
        [
            'Adds half of (0 dB - threshold) x (1 - 1/ratio) for the active topology (6.75 dB at -18 dB and 4:1) on top of makeup, plus the second stage scaled by blendAmount.',
        ],
        [
            'It estimates from threshold and ratio and not from the programme, so at a -40 dB threshold and 8:1 it adds 17.5 dB regardless of how little signal is being reduced.',
        ],
        noExternalModulation
    ),
    autoRelease: parameterGuidance(
        'VCA auto-release switch',
        'Lets the VCA use a programme-dependent release, a fast and a slow envelope, instead of a set time.',
        1,
        1,
        [
            'Heard only by the VCA; while on, release is ignored and the larger of two envelopes with 619 ms and 353 ms release time constants decides the recovery, so a recovery faster than the 619 ms envelope cannot be obtained until this is off.',
        ],
        ['Leaving it on makes a short release value silently inert, so a fast-pump setting needs this off first.'],
        noExternalModulation
    ),
    range: parameterGuidance(
        'Maximum gain reduction',
        'Caps how much gain the compressor may take away in total.',
        6,
        24,
        [
            'Heard only by the VCA; FET fixes 60 dB, Diode fixes 40 dB and Opto has no cap, and ratio and threshold decide how much reduction is requested before this limit applies.',
        ],
        [
            'At 0 dB the VCA can take no gain reduction at all, and with the default 15 dB a deep threshold with a high ratio silently stops reducing past 15 dB.',
        ],
        noExternalModulation
    ),
    lookahead: parameterGuidance(
        'Lookahead delay',
        'Delays the audio so the detector can react to an upcoming transient.',
        0,
        3,
        [
            'Delays the wet and dry audio together and reports the same number of samples as latency, but only Diode reads its detector ahead of that delay, so on VCA, Opto and FET this value adds latency without earlier detection; attack still sets the rate.',
        ],
        [
            'Values above a few milliseconds add noticeable latency for live monitoring, and every millisecond is real delay the host must compensate.',
        ],
        noExternalModulation
    ),
    deltaListen: parameterGuidance(
        'Delta listen',
        'Solos the difference between the time-aligned dry signal and the processed output, so only what the compressor removed is heard.',
        0,
        0,
        [
            'Compares the lookahead-delayed dry with the output after makeup and mix, so changing makeup or mix changes the delta; it should be off for the final render.',
        ],
        ['Leaving it on in an export renders the difference signal instead of the processed programme.'],
        noExternalModulation
    ),
    gainMatchBypass: parameterGuidance(
        'Gain-matched bypass',
        'Keeps the loudness steady when the device is bypassed so on and off compare fairly.',
        0,
        0,
        [
            'Only read while the device is bypassed: it scales the pass-through by the square root of the ratio of the running input to output mean-square level (400 ms average), clamped between 0.1 and 10, using levels learned while the compressor ran; makeup and autoMakeup set what is being matched.',
        ],
        [
            'It has no effect while the device is active, and a bypass before any loudness has been learned passes the signal unmodified.',
        ],
        noExternalModulation
    ),
    oversampling: parameterGuidance(
        'Nonlinear stage oversampling',
        'Reduces aliasing from the FET and diode-bridge distortion, at some extra CPU cost.',
        1,
        2,
        [
            'Heard only by FET and Diode, around xfmrDrive, jfetK3, xfmrK2 and the diode bridge; the legal positions are 1, 2 and 4, with 3 floored to 2.',
        ],
        [
            'VCA and Opto ignore it, so raising it on those topologies spends nothing and fixes nothing; on FET or Diode it adds a few samples of unreported delay on the wet path.',
        ],
        noExternalModulation
    ),
    stereoLink: parameterGuidance(
        'Detector stereo link',
        'Decides whether both channels duck together or breathe independently, keeping the stereo image steady at full link.',
        0.5,
        1,
        [
            'Blends the two detector readings between independent at 0 and the louder channel at 1, in dB; stereoMode dual mono forces it to 0 regardless of this value.',
        ],
        [
            'Below 1 a loud one-sided element ducks only its own side, which shifts the image, and the compressor runs two gain paths, which costs more CPU.',
        ],
        noExternalModulation
    ),
    stereoMode: parameterGuidance(
        'Stereo processing mode',
        'Chooses whether compression acts on left and right (0), only the mid signal (1), only the side signal (2) or two independent mono channels (3).',
        0,
        1,
        [
            'Mid and side modes encode the pair, compress only the chosen component and pass the other through untouched; dual mono forces stereoLink to 0, and detection and threshold apply to the chosen component.',
        ],
        [
            'In mid or side mode the detector hears only the chosen component and the other passes untouched, so a threshold judged against the full mix level can compress far less than expected.',
        ],
        noExternalModulation
    ),
    detection: parameterGuidance(
        'Detector response mode',
        'Chooses whether the detector follows average energy (0) or every instantaneous peak (1).',
        0,
        0,
        [
            'RMS integrates over a 10 ms window and reads about 3 dB below the peak of a sine; peak reads every sample, so threshold sits at a different effective level between the two, and attack decides how quickly either is acted on.',
        ],
        [
            'Peak detection reacts to single-sample spikes that RMS ignores, so with a short attack it takes gain off clipped or spiky transients that would otherwise pass.',
        ],
        noExternalModulation
    ),
    blendTopology: parameterGuidance(
        'Second-stage topology',
        'Chooses the compressor that runs behind the first for a two-stage chain.',
        1,
        2,
        [
            'The second stage runs on the primary output only when blendAmount is above 0.001 and this differs from topology; it shares the same timing and threshold writes, and each stage hears only the controls its topology implements.',
        ],
        [
            'Choosing the same topology as the primary switches stage two off entirely, which makes blendAmount inert, and Opto behind another stage applies its own fixed cell timing on top.',
        ],
        noExternalModulation
    ),
    blendAmount: parameterGuidance(
        'Second-stage blend amount',
        'Fades in a second compressor behind the first, from none toward a full two-stage chain.',
        0,
        0.5,
        [
            'Crossfades the single-stage and two-stage output and scales the second stage reduction in the meter; blendTopology must differ from topology, and autoMakeup adds the second stage scaled by this amount.',
        ],
        [
            'Stacking two compressors deepens total gain reduction and adds the second stage colour, so makeup and threshold set for one stage over-compress with two.',
        ],
        noExternalModulation
    ),
};
