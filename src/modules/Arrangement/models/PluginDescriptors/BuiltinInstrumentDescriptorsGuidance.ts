import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION } from './GuidanceProfiles';

function synthParameterGuidance(
    semanticRole: string,
    perceptualRole: string,
    minimum: number,
    maximum: number,
    interactions: readonly string[],
    risks: readonly string[]
): DeviceParameterGuidance {
    return parameterGuidance(
        semanticRole,
        perceptualRole,
        minimum,
        maximum,
        interactions,
        risks,
        NO_SOURCE_SPECIFIC_MODULATION
    );
}

/** Guidance for the Web Audio oscillator, filter, envelope, and vibrato graph. */
export const BUILTIN_SYNTH_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    waveform: synthParameterGuidance(
        'Primary oscillator waveform selection',
        'Chooses the harmonic profile of the main oscillator, from rounded triangle tone to bright saw or square tone.',
        1,
        3,
        ['Shape the selected waveform with filterCutoff, and balance it against osc2Waveform with osc2Mix.'],
        ['Sawtooth and square settings expose more upper harmonics, so a high filterCutoff can become brittle.']
    ),
    attack: synthParameterGuidance(
        'Amplitude-envelope attack duration',
        'Sets how quickly the note rises to its velocity-scaled peak; harder notes shorten this rise in the engine.',
        0.005,
        0.3,
        ['attack also holds filterEnvAmount at its peak before decay begins, so set it with decay.'],
        ['Long attack values can erase rhythmic note onsets and delay the start of the filter-envelope fall.']
    ),
    decay: synthParameterGuidance(
        'Amplitude and filter-envelope decay duration',
        'Sets how quickly level falls from the attack peak to sustain and how quickly an opened filter returns to filterCutoff.',
        0.05,
        1.2,
        ['decay shapes both the amplitude move toward sustain and the filterEnvAmount sweep.'],
        ['A long decay with high sustain can make successive notes overlap at nearly full level.']
    ),
    sustain: synthParameterGuidance(
        'Amplitude-envelope sustain ratio',
        'Sets the held-note level as a fraction of the velocity-scaled peak after decay.',
        0.3,
        0.8,
        ['The held level multiplies gain, while decay controls how quickly the note reaches it.'],
        ['A sustain value near zero makes held notes disappear after decay, even before note-off.']
    ),
    release: synthParameterGuidance(
        'Amplitude-envelope release duration',
        'Sets how long the voice fades from its note-off level to silence.',
        0.1,
        1.2,
        ['Set release with sustain and gain because released voices continue contributing to the output.'],
        ['Long releases accumulate overlapping voices and can consume headroom across chords.']
    ),
    filterCutoff: synthParameterGuidance(
        'Velocity-, pitch-, and pressure-scaled filter corner',
        'Sets the base brightness or spectral focus before note pitch, velocity sensitivity, and MPE pressure move the corner.',
        200,
        8000,
        ['filterType defines which side of filterCutoff passes, while filterResonance emphasizes the corner.'],
        [
            "A highpass filter attenuates frequencies below the cutoff, so raising filterCutoff can remove low-frequency body; a bandpass filter attenuates frequencies outside the band around the cutoff, so moving filterCutoff away from a note's strongest partials can thin or silence it.",
        ]
    ),
    filterResonance: synthParameterGuidance(
        'Biquad filter Q',
        'Adds a peak around filterCutoff; MPE slide replaces this setting with a zero-to-20 Q value for that note.',
        0.5,
        6,
        [
            'Judge filterResonance at the active filterCutoff and filterType because both determine where the peak lands.',
        ],
        ['High Q can create a narrow level spike, and MPE slide can drive that spike beyond the stored setting.']
    ),
    filterType: synthParameterGuidance(
        'Biquad filter response selection',
        'Chooses lowpass darkening or highpass thinning for common shaping; bandpass isolates the cutoff region.',
        0,
        1,
        [
            'Set filterType before filterCutoff and filterResonance because it changes what the frequency and Q controls mean.',
        ],
        ['Highpass and bandpass choices can remove fundamental energy from bass notes.']
    ),
    filterEnvAmount: synthParameterGuidance(
        'Positive filter-envelope peak offset',
        'Raises the filter above filterCutoff for the attack, then sweeps it back during decay.',
        0,
        4000,
        ['The sweep holds for attack and returns over decay, with filterCutoff as its destination.'],
        ['Large offsets near the audible ceiling are clamped, reducing the expected envelope movement.']
    ),
    detune: synthParameterGuidance(
        'Primary tuning offset in cents',
        'Shifts the first oscillator and the tuning base used by the second oscillator without retuning the octave-down sub.',
        -20,
        20,
        ['osc2Detune is added on top of detune for the second oscillator, so tune the pair together.'],
        [
            'Large global offsets move the played pitch away from equal temperament while subOscLevel remains at the note frequency.',
        ]
    ),
    gain: synthParameterGuidance(
        'Velocity-scaled voice output gain',
        'Sets the peak amplitude of each note before sustain and clip gain scale it.',
        0.15,
        0.5,
        ['Balance gain against subOscLevel, noiseLevel, and the number of overlapping release tails.'],
        ['High gain can clip downstream processing when velocity, chords, and long release tails coincide.']
    ),
    osc2Waveform: synthParameterGuidance(
        'Second oscillator waveform selection',
        'Chooses the second oscillator harmonic profile whenever osc2Mix activates that oscillator.',
        1,
        3,
        ['osc2Waveform is inaudible at osc2Mix zero and combines with waveform above zero.'],
        ['A bright second waveform can add unexpected high-frequency energy when osc2Mix is raised.']
    ),
    osc2Detune: synthParameterGuidance(
        'Second oscillator relative tuning in cents',
        'Offsets only oscillator two from the detune-shifted primary pitch, creating beating or pitched intervals.',
        -20,
        20,
        ['The engine adds osc2Detune to detune, and osc2Mix determines how strongly the offset is heard.'],
        ['Wide offsets can turn gentle thickening into a separate interval and obscure the played pitch.']
    ),
    osc2Mix: synthParameterGuidance(
        'Two-oscillator crossfade',
        'Moves level from oscillator one to oscillator two and enables the second oscillator above zero.',
        0,
        0.5,
        [
            'stereoSpread only separates the oscillators when osc2Mix is above zero; osc2Detune sets their pitch difference.',
        ],
        ['Strong blends with wide osc2Detune can produce conspicuous beating and unstable mono balance.']
    ),
    subOscLevel: synthParameterGuidance(
        'Octave-down sine layer level',
        'Adds a sine oscillator one octave below the played note without reducing either main oscillator.',
        0,
        0.7,
        ['Balance subOscLevel with gain and filterCutoff because the added bass feeds the same filter and envelope.'],
        ['High sub level consumes low-frequency headroom and can mask the fundamental of neighboring bass parts.']
    ),
    noiseLevel: synthParameterGuidance(
        'Short noise-transient level',
        'Adds a 50 ms decaying noise burst at note onset for pick, breath, or hammer texture.',
        0,
        0.15,
        [
            'filterType and filterCutoff shape the burst, while attack controls how much of it reaches the amplitude envelope.',
        ],
        ['Excess noise level can make every onset harsh and raise transient peaks without sustaining the note.']
    ),
    vibratoRate: synthParameterGuidance(
        'Pitch-vibrato LFO frequency',
        'Sets the speed of delayed sine-wave pitch modulation when vibratoDepth is also above zero.',
        4,
        7,
        ['vibratoRate is active only with vibratoDepth, and vibratoDelay determines when the motion fades in.'],
        ['Rates above a natural vibrato range can sound like rapid pitch flutter or sideband-rich modulation.']
    ),
    vibratoDepth: synthParameterGuidance(
        'Pitch-vibrato excursion in cents',
        'Sets how far delayed vibrato bends every active main, second, and sub oscillator.',
        0,
        25,
        [
            'vibratoDepth requires vibratoRate above zero and reaches full depth after the velocity-scaled amplitude attack, vibratoDelay, and a 100 ms ramp.',
        ],
        ['Deep vibrato can make sustained notes sound out of tune and exaggerate osc2Detune beating.']
    ),
    stereoSpread: synthParameterGuidance(
        'Dual-oscillator stereo pan distance',
        'Pans oscillator one left and oscillator two right by matching amounts when the second oscillator is active.',
        0,
        0.75,
        [
            'stereoSpread has no effect at osc2Mix zero; osc2Detune changes the phase relationship across the stereo pair.',
        ],
        ['Maximum spread can weaken the center and expose phase cancellation when the mix is collapsed to mono.']
    ),
    vibratoDelay: synthParameterGuidance(
        'Post-attack vibrato onset delay',
        'Waits after the amplitude attack before fading vibrato depth in over 100 ms.',
        0.1,
        0.8,
        [
            'Vibrato stays at zero through the velocity-scaled amplitude attack and vibratoDelay, then reaches full depth over a 100 ms ramp; vibratoRate and vibratoDepth must both be active.',
        ],
        ['A long delay can prevent vibrato from becoming audible on short notes.']
    ),
    filterVelocitySensitivity: synthParameterGuidance(
        'Velocity-to-filter scaling depth',
        'Darkens softer notes below filterCutoff while leaving hard notes at the full pitch-tracked cutoff.',
        0,
        0.75,
        ['filterVelocitySensitivity scales filterCutoff before filterEnvAmount and MPE pressure are added.'],
        ['High sensitivity can make low-velocity notes unexpectedly dull or nearly inaudible through a low cutoff.']
    ),
};
