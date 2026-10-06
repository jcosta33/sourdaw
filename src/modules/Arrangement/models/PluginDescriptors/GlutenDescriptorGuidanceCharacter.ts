import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

/**
 * Per-parameter guidance for Gluten's detector sidechain filters and the
 * topology-owned character controls, taken from `crates/daw-dsp/src/gluten`.
 *
 * Every sidechain filter conditions only the signal the detector reads: the
 * audio path is never filtered. Each topology owns its own sidechain chain, so
 * the same writes reach all four. The character controls belong to one
 * topology each (VCA: vcaCharacter, vcaType, feedForward; Opto: limitMode; FET:
 * inputGain, outputGain, xfmrDrive, jfetK3, xfmrK2, allButtons; Diode:
 * recovery) and are silent while that topology is neither primary nor the
 * running second stage.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const GLUTEN_CHARACTER_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    scHpfFreq: parameterGuidance(
        'Detector high-pass corner',
        'Keeps bass out of what the compressor reacts to, so kick and bass stop triggering gain reduction.',
        60,
        150,
        [
            'A 12 dB per octave Butterworth high-pass on the detector input only; scHpfEnabled must be on for it to act, and it changes how much of the low end threshold sees.',
        ],
        [
            'Above about 200 Hz the compressor stops hearing the body of the programme and compresses mostly on upper-mid content, so low-frequency peaks can pass unreduced and push the next stage.',
        ],
        noExternalModulation
    ),
    scHpfEnabled: parameterGuidance(
        'Detector high-pass switch',
        'Turns the detector high-pass filter on or off.',
        1,
        1,
        [
            'Enables the filter that scHpfFreq tunes; with it off the detector hears the full-range signal, and scEqEnabled and scLpfEnabled have their own switches in the same chain.',
        ],
        [
            'Turning it off on bass-heavy material lets low frequencies drive gain reduction, which causes pumping the filter was preventing.',
        ],
        noExternalModulation
    ),
    thrust: parameterGuidance(
        'Detector spectral tilt',
        'Shifts what the compressor listens for toward bright content, so it reacts to bite and ignores weight.',
        0,
        1,
        [
            'Position 0 is off, 1 tilts the detector to 0.5 times the lows and 1.5 times the highs around 640 Hz, and 2 removes the lows and doubles the highs; it stacks after the scHpfFreq, scLpfFreq and scEqGain filters.',
        ],
        [
            'Position 2 boosts bright content in the detector by 6 dB, so the effective threshold on cymbals and sibilance drops by about that much while bass barely compresses.',
        ],
        noExternalModulation
    ),
    scLpfFreq: parameterGuidance(
        'Detector low-pass corner',
        'Keeps hiss and sibilance out of what the compressor reacts to.',
        6000,
        20000,
        [
            'A 12 dB per octave Butterworth low-pass on the detector input only; scLpfEnabled must be on for it to act, and thrust and scHpfFreq shape the other end of the same detector band.',
        ],
        [
            'Lowering it to a few kilohertz makes the compressor ignore hats and sibilance, so a bright bus can compress less than its meter level suggests.',
        ],
        noExternalModulation
    ),
    scLpfEnabled: parameterGuidance(
        'Detector low-pass switch',
        'Turns the detector low-pass filter on or off.',
        0,
        0,
        ['Enables the filter that scLpfFreq tunes; it is off by default and does nothing to the audio path.'],
        [
            'The default 20 kHz corner leaves the detector essentially wide open, so turning this on without lowering scLpfFreq changes almost nothing.',
        ],
        noExternalModulation
    ),
    scEqFreq: parameterGuidance(
        'Detector bell frequency',
        'Chooses which frequency region the detector bell boosts or cuts, for frequency-dependent compression.',
        500,
        5000,
        [
            'Centre of a peaking filter on the detector input only; it does nothing until scEqEnabled is on and scEqGain is away from 0 dB, and scEqQ sets its width.',
        ],
        [
            'It has no effect at 0 dB gain, and a boost here makes the compressor react more to that band while a cut makes it ignore it, which changes the audible result only through the gain reduction.',
        ],
        noExternalModulation
    ),
    scEqGain: parameterGuidance(
        'Detector bell gain',
        'Makes the compressor more sensitive to a chosen band when boosted and less sensitive when cut, like a de-esser or a bass-ducking key.',
        -6,
        6,
        [
            'Peaking gain from -18 to +18 dB on the detector only, applied while scEqEnabled is on and it is at least 0.01 dB away from zero; scEqFreq and scEqQ place and shape it.',
        ],
        [
            'A +6 dB bell lowers the effective threshold for that band by about 6 dB, so tonal programme in the band over-compresses, while a deep cut can make the compressor miss loud events in that band entirely.',
        ],
        noExternalModulation
    ),
    scEqQ: parameterGuidance(
        'Detector bell width',
        'Sets how narrowly the detector bell targets its band, from broad to surgical.',
        0.7,
        3,
        [
            'Peaking Q from 0.1 to 10 on the detector bell; only applies while scEqEnabled is on and scEqGain is away from 0 dB, and scEqFreq decides where it sits.',
        ],
        [
            'High Q with a large boost makes the compressor key on one frequency, so notes that land on it pump while neighbouring notes do not.',
        ],
        noExternalModulation
    ),
    scEqEnabled: parameterGuidance(
        'Detector bell switch',
        'Turns the detector bell filter on or off.',
        0,
        0,
        [
            'Enables the bell that scEqFreq, scEqGain and scEqQ shape; it is off by default and a gain of 0 dB is a no-op even when it is on.',
        ],
        ['Turning it on with scEqGain at 0 does nothing, which can read as a broken control.'],
        noExternalModulation
    ),
    extSidechain: parameterGuidance(
        'External sidechain source',
        'Makes the compressor react to a separate key signal instead of its own input, for ducking and rhythmic pumping.',
        0,
        0,
        [
            'Replaces the detector source with the second audio input, after which scHpfFreq, scLpfFreq, scEqGain and thrust still condition it; mid and side modes encode the key the same way.',
        ],
        [
            'With nothing routed to the second input the key buffer is silence, so the detector hears nothing and the compressor stops reducing gain entirely.',
        ],
        noExternalModulation
    ),
    inputGain: parameterGuidance(
        'FET input drive',
        'Pushes more level into the FET gain stage and distortion, like the input control of a hardware FET limiting amplifier.',
        0,
        12,
        [
            'Heard only by FET, ahead of gain reduction and the JFET and transformer stages; the FET detector reads its own output, so the level it hears rises with this, and outputGain trims it back.',
        ],
        [
            'Raising it increases gain reduction and distortion together, and the 24 dB maximum adds heavy odd-harmonic colour and lifts the level that reaches the next stage.',
        ],
        noExternalModulation
    ),
    outputGain: parameterGuidance(
        'FET output level',
        'Sets the level leaving the FET stage so heavy input drive can be matched back to unity.',
        -12,
        0,
        [
            'Heard only by FET, after the JFET and transformer stages and ahead of makeup and mix; inputGain, xfmrDrive and makeup set what it compensates.',
        ],
        [
            'The FET detector reads this level, so raising it also raises the gain reduction it measures; trim loudness with makeup when the compression itself should stay unchanged.',
        ],
        noExternalModulation
    ),
    xfmrDrive: parameterGuidance(
        'FET transformer saturation',
        'Adds rounded, thicker saturation from the output transformer of the FET stage.',
        0.5,
        2,
        [
            'Heard only by FET, as tanh(x x drive) / tanh(drive), which keeps full scale at unity but lifts quiet signals by drive/tanh(drive), about +3.2 dB at 1.2 and +9.5 dB at 3; below 0.01 it is bypassed, and xfmrK2 and oversampling shape its harmonics.',
        ],
        [
            'Because small signals are boosted more than peaks, raising it also compresses dynamics and raises the noise floor and the level the FET detector hears, independent of the gain-reduction controls.',
        ],
        noExternalModulation
    ),
    jfetK3: parameterGuidance(
        'FET JFET odd-harmonic amount',
        'Adds third-harmonic grit by bending the FET gain stage with a cubic curve.',
        0.05,
        0.3,
        [
            'Heard only by FET, applied as x minus k3 x cubed before the transformer stage; xfmrDrive adds saturation after it and oversampling controls aliasing from it.',
        ],
        [
            'The cubic term folds the waveform back once a peak passes 1/sqrt(3 x k3) of full scale, which is about 0.82 at 0.5, so strong settings on a hot signal distort harshly.',
        ],
        noExternalModulation
    ),
    xfmrK2: parameterGuidance(
        'FET transformer even-harmonic amount',
        'Adds second-harmonic warmth and asymmetry from the FET transformer.',
        0,
        0.1,
        [
            'Heard only by FET, applied as y plus k2 y squared after xfmrDrive saturation; jfetK3 sets the odd harmonics that sit beside it.',
        ],
        [
            'The squared term also adds a DC offset and lifts positive peaks, up to 30 percent of the peak at the maximum, which costs headroom for the next stage.',
        ],
        noExternalModulation
    ),
    allButtons: parameterGuidance(
        'FET all-buttons-in mode',
        'Pushes the FET compressor into its aggressive all-ratios-in curve.',
        0,
        0,
        [
            'Heard only by FET; replaces the ratio setting with an effective ratio of about 12:1 that rises toward 18:1 after a transient, so ratio, knee and amount no longer set the slope.',
        ],
        [
            'It holds a 12:1 to 18:1 slope whatever ratio says, which flattens dynamics heavily, so it suits an effect rather than bus glue.',
        ],
        noExternalModulation
    ),
    limitMode: parameterGuidance(
        'Opto compress or limit switch',
        'Chooses the Opto cell behaviour as a gentle compressor (0) or a firmer limiter (1).',
        0,
        0,
        [
            'Heard only by Opto, where it moves the maximum cell ratio from 6:1 to 10:1 and refreshes auto makeup; threshold sets where it starts and ratio, attack and release do not apply to this topology.',
        ],
        [
            'Limit mode raises the cell ratio ceiling to 10:1, so peaks over the threshold are clamped much harder than in compress mode, and it recomputes the auto makeup level with it.',
        ],
        noExternalModulation
    ),
    recovery: parameterGuidance(
        'Diode recovery position',
        'Chooses one of five fixed release speeds for the diode-bridge compressor, from snappy to very slow.',
        2,
        5,
        [
            'Heard only by Diode, where positions 1 to 5 mean 50, 100, 400, 800 and 1500 ms and overwrite the release time; release and autoRelease do not apply to this topology, and attack sets the opposite edge.',
        ],
        [
            'Position 1 at 50 ms can follow low-frequency cycles and distort bass, while 5 at 1.5 s holds the gain down long after a phrase ends.',
        ],
        noExternalModulation
    ),
    vcaCharacter: parameterGuidance(
        'VCA second-harmonic colour',
        'Adds a touch of console-style second-harmonic warmth to the VCA output, growing with gain reduction.',
        0.001,
        0.01,
        [
            'Heard only by VCA, as x plus k (1 + 0.02 times gain reduction in dB) x squared; writing vcaType replaces this with its preset (0, 0.003 or 0.008), so set this after it.',
        ],
        [
            'It scales with gain reduction, so at the 0.02 maximum and 15 dB of reduction the squared term reaches about 2.6 percent of the peak, with a small DC offset.',
        ],
        noExternalModulation
    ),
    vcaType: parameterGuidance(
        'VCA model selector',
        'Chooses the VCA voicing: ideal and clean (0), THAT 2181 subtle colour (1) or DBX 202 warmer colour (2).',
        1,
        2,
        [
            'Heard only by VCA; each position sets vcaCharacter to 0, 0.003 or 0.008, so writing it overwrites a hand-set vcaCharacter.',
        ],
        [
            'Position 0 removes all distortion, so a clean reference comparison on a bus is only valid there, and position 2 applies about 2.7 times the second-harmonic amount of position 1 (0.008 against 0.003).',
        ],
        noExternalModulation
    ),
    feedForward: parameterGuidance(
        'VCA detector topology switch',
        'Chooses whether the VCA detects from its own output (0, the console-style feedback default) or from its input (1).',
        0,
        0,
        [
            'Heard only by VCA; feedback listens to the already-reduced signal, which softens the effective ratio, while feed-forward reads the delayed input and follows threshold and ratio exactly; ratio, attack and release behave differently under each.',
        ],
        [
            'Feed-forward is more aggressive at the same ratio and threshold, so settings tuned for the feedback default over-compress after switching.',
        ],
        noExternalModulation
    ),
};
