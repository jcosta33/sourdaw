import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for the Faust electric-piano and supersaw instruments, taken from
 * their `.dsp` sources in `PluginHost/useCases/faustEngine/dsp/`.
 *
 * Both compile as `FaustPolyDspGenerator` instruments with eight voices
 * (`createFaustNode`). The poly voice allocator writes `freq`, `gate` and
 * `gain` on the voice it assigns at each note-on (`freq` = the MIDI pitch's
 * frequency, `gain` = velocity / 127), and a parameter write from the
 * inspector or an automation lane reaches every voice at once. Voice outputs
 * are summed. The FM instrument lives in `FaustInstrumentDescriptorsGuidanceFm.ts`.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const ELECTRIC_PIANO_GUIDANCE = instrumentGuidance(
    'Play a two-partial FM electric-piano voice: a 1:1 body and a 14:1 bell partial on separate envelopes, both scaled by note velocity.',
    [
        'Note velocity sets both the output level and the FM depth through the gain control, so audition brightness at the velocities the part actually uses.',
    ],
    [
        'brightness and note velocity set the FM index of both partials; body_decay and bell_decay set how long each partial rings while a key is held.',
    ],
    ['Up to eight voices sum into one output, so dense high-velocity chords can exceed full scale.']
);

export const ELECTRIC_PIANO_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    brightness: parameterGuidance(
        'FM index scale for the body and bell partials',
        'Raises the body partial’s FM index from 0.5 to 3.5 times the note gain, adding upper sidebands to the body; the bell partial’s index stays at one twenty-eighth of the body’s.',
        0.1,
        0.7,
        [
            'Multiplies with gain, which each note-on replaces with velocity/127, so the same brightness is darker on soft notes and brighter on hard ones.',
        ],
        [
            'At brightness 1 and full velocity the body index reaches 3.5, whose Carson bandwidth puts the upper sideband edge at the note frequency plus 4.5 times it (5.5 times the note), which passes the 22.05 kHz Nyquist limit of a 44.1 kHz rate for notes above about 4 kHz.',
        ],
        noExternalModulation
    ),
    body_decay: parameterGuidance(
        'Body-partial decay time to its fixed 15 percent sustain',
        'Sets how long the 1:1 body partial takes to fall linearly from its peak to the fixed 0.15 sustain level while the key is held.',
        0.5,
        3,
        [
            'After note-off the body fades over a fixed 0.3 s whatever body_decay is, while bell_decay times the separate bell partial; the descriptor reports body_decay as the instrument tail.',
        ],
        [
            'A body_decay longer than the note means note-off starts the fixed 0.3 s release from near peak level, so short notes end with an abrupt fade.',
        ],
        noExternalModulation
    ),
    bell_decay: parameterGuidance(
        'Bell-partial decay time to silence',
        'Sets how long the bell partial at 14 times the note frequency takes to fall linearly from its peak to zero, which shapes the strike at the start of each note.',
        0.05,
        0.4,
        [
            'The bell contributes 30 percent of the voice output against the body’s 70 percent, so bell_decay changes the onset while body_decay governs the held sound.',
        ],
        [
            'The bell carrier runs at 14 times freq, which passes the 22.05 kHz Nyquist limit of a 44.1 kHz rate for notes above about 1575 Hz, so a long bell_decay keeps aliased tones audible on the top octaves.',
        ],
        noExternalModulation
    ),
    gain: parameterGuidance(
        'Per-voice velocity level and FM depth',
        'Scales the voice output and the FM index together; each note-on overwrites it on that voice with velocity/127.',
        0.4,
        1,
        [
            'gain multiplies the brightness-derived index as well as the output, so harder notes are louder and brighter.',
        ],
        [
            'A value written from the inspector or an automation lane reaches every allocated voice but lasts only until that voice’s next note-on, so it cannot hold a steady level.',
        ],
        noExternalModulation
    ),
    freq: parameterGuidance(
        'Per-voice note frequency',
        'Sets the pitch of the body and bell partials; each note-on overwrites it with the played MIDI pitch.',
        27.5,
        1500,
        [
            'The bell partial sits at 14 times freq, so bell_decay decides how long the highest, alias-prone partial lasts on upper notes.',
        ],
        [
            'Writing freq from automation retunes every sounding voice to one frequency at once, collapsing a chord to a single pitch until each voice’s next note-on.',
        ],
        noExternalModulation
    ),
    gate: parameterGuidance(
        'Per-voice envelope trigger',
        'Opens (1) or releases (0) both partial envelopes; note-on sets it to 1 and note-off to 0 on the voice that plays the note.',
        0,
        0,
        [
            'Writing gate 0 releases every voice through the fixed body and bell releases (0.3 s and 0.1 s); body_decay and bell_decay restart when it rises again.',
        ],
        [
            'Writing gate 1 reopens every allocated voice at once, including voices note-off already released, and they keep sounding until a later gate 0 write such as the transport stop’s all-notes-off.',
        ],
        noExternalModulation
    ),
};

export const SUPERSAW_GUIDANCE = instrumentGuidance(
    'Play a seven-sawtooth unison voice through a resonant lowpass with its own cutoff LFO and ADSR; it has no level or velocity control of its own.',
    [
        'Note velocity and clip gain do not change this instrument’s level, because its DSP declares no gain control for the voice allocator to write; set its level after it on the track.',
    ],
    [
        'detune and center_mix set the unison width; cutoff, resonance, lfo_rate and lfo_depth filter the summed saws of each voice.',
    ],
    [
        'High resonance lifts the response at cutoff to up to 8.9 times the passband, and up to eight voices sum, so resonant chords can exceed full scale.',
    ]
);

export const SUPERSAW_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    lfo_rate: parameterGuidance(
        'Cutoff-LFO frequency',
        'Sets the speed of the sine LFO each voice runs on its own filter cutoff; inaudible while lfo_depth is 0.',
        0.2,
        8,
        ['Only acts when lfo_depth is above zero, and the sweep is centred on cutoff.'],
        [
            'The swept cutoff passes through a one-pole smoother (si.smoo, about a 22.7 ms time constant, −3 dB near 7 Hz) that passes about 0.81 of the set sweep at 5 Hz, 0.66 at 8 Hz and 0.33 at the 20 Hz ceiling, so raising lfo_rate makes the sweep shallower than lfo_depth sets.',
        ],
        noExternalModulation
    ),
    lfo_depth: parameterGuidance(
        'Cutoff-LFO depth',
        'Sets the cutoff sweep as cutoff × (1 ± 0.5 × depth), clamped to 100 Hz–20 kHz and then smoothed by a one-pole lowpass that passes about 0.99 of it at 1 Hz, 0.81 at 5 Hz, 0.66 at 8 Hz and 0.33 at 20 Hz, so depth 1 reaches plus or minus 50 percent only at slow rates.',
        0,
        0.5,
        [
            'The sweep scales with cutoff, so the same lfo_depth moves a 6 kHz cutoff by more hertz than a 600 Hz one; lfo_rate sets its speed.',
        ],
        [
            'With resonance high, a deep sweep drags the resonant peak across the harmonics and swings the level of each harmonic it passes, producing periodic level spikes.',
        ],
        noExternalModulation
    ),
    detune: parameterGuidance(
        'Unison voice spread in cents per step',
        'Spreads the six side sawtooths symmetrically at plus or minus 1, 2 and 3 times this many cents around the centre voice.',
        5,
        30,
        ['Inaudible when center_mix is 1, because the side voices are scaled by 1 − center_mix.'],
        [
            'At 100 the outer pair sits 300 cents (a minor third) either side of the note, so the unison becomes a cluster of separate pitches rather than one thickened note.',
        ],
        noExternalModulation
    ),
    center_mix: parameterGuidance(
        'Centre versus side-voice balance',
        'Sets the centre sawtooth level directly and the six detuned side voices by 1 − center_mix, weighted 0.5, 0.4 and 0.3 per pair.',
        0.3,
        0.8,
        ['detune only matters through the side voices, so lowering center_mix makes the detune spread more prominent.'],
        [
            'The summed level at coincident peaks is (center_mix + 2.4 × (1 − center_mix)) / 3.4, so moving from 1 to 0 raises it from 0.29 to 0.71 (about +7.6 dB) before the filter.',
        ],
        noExternalModulation
    ),
    cutoff: parameterGuidance(
        'Resonant lowpass corner',
        'Sets the corner of the second-order resonant lowpass the summed saws pass through; lower values remove more upper harmonics.',
        400,
        12000,
        [
            'resonance sets the peak at this corner, and lfo_depth sweeps it by up to 50 percent, less at faster lfo_rate settings because the swept cutoff is smoothed.',
        ],
        [
            'A low cutoff with high resonance multiplies whichever harmonic sits at the corner by up to 8.9, so notes whose harmonic lands there jump in level.',
        ],
        noExternalModulation
    ),
    resonance: parameterGuidance(
        'Lowpass resonance mapped to Q 1 to 8.92',
        'Raises the filter Q as 1 + 8 × resonance, which lifts the response at the cutoff to Q times the passband.',
        0,
        0.6,
        ['Judge it at the active cutoff and lfo_depth, because they decide where the peak lands.'],
        [
            'At 0.99 the response at the corner is about 8.9 times (+19 dB) the passband, enough to clip when a strong harmonic coincides with the cutoff.',
        ],
        noExternalModulation
    ),
    attack: parameterGuidance(
        'Amplitude-envelope attack time',
        'Sets the linear rise from silence to full level after note-on.',
        0.001,
        0.5,
        ['decay starts only after the attack completes, so attack and decay together set when sustain is reached.'],
        [
            'An attack longer than the note never reaches full level, and the release then fades from wherever the rise stopped.',
        ],
        noExternalModulation
    ),
    decay: parameterGuidance(
        'Amplitude-envelope decay time',
        'Sets the linear fall from full level to the sustain level.',
        0.05,
        1.5,
        [
            'Has no audible effect when sustain is 1, since the envelope is already at its sustain level after the attack.',
        ],
        ['A short decay with a low sustain turns every note into a pluck that fades out under held chords.'],
        noExternalModulation
    ),
    sustain: parameterGuidance(
        'Amplitude-envelope sustain level',
        'Sets the held level as a fraction of the peak while the key stays down.',
        0.4,
        1,
        ['decay sets how fast the level reaches sustain, and release fades from it after note-off.'],
        [
            'At 0 held notes fall silent after the decay yet stay allocated until note-off, so silent held notes still occupy their share of the eight voices.',
        ],
        noExternalModulation
    ),
    release: parameterGuidance(
        'Amplitude-envelope release time',
        'Sets the linear fade to silence after note-off.',
        0.05,
        2,
        [
            'Starts from the level attack, decay and sustain reached at note-off; the descriptor reports release as the instrument tail.',
        ],
        [
            'Long releases keep voices allocated, so fast passages run out of the eight voices and steal released voices mid-fade.',
        ],
        noExternalModulation
    ),
    freq: parameterGuidance(
        'Per-voice note frequency',
        'Sets the centre sawtooth pitch, with the six side voices placed around it; each note-on overwrites it with the played MIDI pitch.',
        27.5,
        4186,
        ['detune spreads the side voices around freq by up to 3 × detune cents either side.'],
        [
            'Writing freq from automation retunes every sounding voice to one pitch at once, collapsing a chord until each voice’s next note-on.',
        ],
        noExternalModulation
    ),
    gate: parameterGuidance(
        'Per-voice amplitude-envelope trigger',
        'Starts (1) or releases (0) the ADSR; note-on and note-off set it on the voice that plays the note.',
        0,
        0,
        ['Writing gate 0 releases every voice over release; attack restarts when gate rises again.'],
        [
            'Writing gate 1 reopens every allocated voice at once, including voices note-off already released, and they hold at sustain until a later gate 0 write such as the transport stop’s all-notes-off.',
        ],
        noExternalModulation
    ),
};
