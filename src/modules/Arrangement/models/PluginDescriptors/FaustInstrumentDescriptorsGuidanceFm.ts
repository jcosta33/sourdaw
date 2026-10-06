import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for the four-operator Faust FM instrument, taken from
 * `PluginHost/useCases/faustEngine/dsp/fm-synth.dsp`.
 *
 * Every operator is a sine at `freq × ratio` with its own linear ADSR on the
 * shared `gate`. A modulator's output is scaled by its own frequency, so its
 * level is its modulation index (0 to 1). Routing by `algorithm`: 0 cascades
 * 4→3→2→1; 1 feeds 4 and 3 into 2→1; 2 feeds 4→3 and 2 into 1; 3 runs 4→3
 * and 2→1 and outputs (op1 + op3) × 0.5. op1 is a carrier in every
 * algorithm; op3 is a carrier only in algorithm 3. The poly voice allocator
 * overwrites `freq`, `gate` and `gain` per voice exactly as described in
 * `FaustInstrumentDescriptorsGuidance.ts`.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const FM_SYNTH_GUIDANCE = instrumentGuidance(
    'Play a four-operator sine FM voice: algorithm routes the operators, each ratio multiplies the note frequency, and each operator has its own level and ADSR.',
    [
        'Note velocity sets the output level through gain, and op1_level (with op3_level in algorithm 3) sets the carrier level, so set those before adding modulation.',
    ],
    [
        'Modulator levels are FM indices from 0 to 1 because each modulator output is scaled by its own frequency; the ratios decide where the resulting sidebands fall.',
    ],
    [
        'Up to eight voices sum into one output, and high operator ratios on high notes push carriers and sidebands past Nyquist, where they fold back as inharmonic tones.',
    ]
);

export const FM_SYNTH_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    algorithm: parameterGuidance(
        'Operator routing selection',
        'Selects how the four operators connect: 0 is the cascade 4→3→2→1, 1 feeds 4 and 3 in parallel into 2→1, 2 feeds 4→3 and 2 in parallel into 1, and 3 runs two stacks, 4→3 and 2→1, with op1 and op3 both heard at half level.',
        0,
        2,
        [
            'In algorithms 0 to 2 only op1 is heard, so op1_level is the carrier level; in algorithm 3 op3 also becomes a carrier and op3_level sets its level instead of a modulation index.',
        ],
        [
            'All four routings are computed at once and the output switches between them with no crossfade, so changing algorithm while a note sounds jumps between differently modulated waveforms and can click.',
        ],
        noExternalModulation
    ),
    op1_ratio: parameterGuidance(
        'Carrier frequency multiplier',
        'Sets op1, the operator heard in every algorithm, at this multiple of the note frequency, so under light modulation it sets the perceived pitch: 2 sounds an octave up and non-integer values detune the note from the played key.',
        0.5,
        4,
        [
            'op2_ratio sets the sideband spacing around op1, so integer values of both ratios keep the sidebands on the harmonic series of the note.',
        ],
        [
            'op1 runs at op1_ratio × freq before modulation, so ratio 16 places the carrier itself above the 22.05 kHz Nyquist limit of a 44.1 kHz rate for notes above about 1.4 kHz.',
        ],
        noExternalModulation
    ),
    op1_level: parameterGuidance(
        'Carrier output level',
        'Scales op1’s output, which is the whole instrument output in algorithms 0 to 2 and half of it in algorithm 3.',
        0.5,
        1,
        [
            'Multiplies with op1’s envelope (op1_attack, op1_decay, op1_sustain, op1_release) and the velocity-driven gain.',
        ],
        [
            'At 0 the instrument is silent in algorithms 0 to 2 whatever the other operators do, because op1 is the only carrier there.',
        ],
        noExternalModulation
    ),
    op1_attack: parameterGuidance(
        'Carrier envelope attack time',
        'Sets how long op1’s output takes to rise linearly to full level after note-on, which is the audible onset of the note.',
        0.001,
        0.2,
        [
            'op1_decay starts only when this rise completes; modulator attacks such as op2_attack shape the brightness onset separately.',
        ],
        [
            'An attack longer than the note never reaches full level, so short notes sound quieter than their velocity implies.',
        ],
        noExternalModulation
    ),
    op1_decay: parameterGuidance(
        'Carrier envelope decay time',
        'Sets the linear fall of op1’s level from its peak to op1_sustain.',
        0.05,
        2,
        ['Has no effect when op1_sustain is 1.'],
        ['A short decay with a low op1_sustain turns held notes into plucks whose level drops before the chord ends.'],
        noExternalModulation
    ),
    op1_sustain: parameterGuidance(
        'Carrier envelope sustain level',
        'Sets the level op1 holds while the key stays down, as a fraction of its peak.',
        0.3,
        1,
        ['op1_decay sets how quickly it is reached, and op1_release fades from it after note-off.'],
        ['At 0 held notes go silent after op1_decay while their voice stays allocated, using up the eight voices.'],
        noExternalModulation
    ),
    op1_release: parameterGuidance(
        'Carrier envelope release time',
        'Sets how long op1 fades linearly to silence after note-off, which is the audible tail of the note.',
        0.05,
        3,
        ['If a modulator release such as op2_release is shorter, the tail loses its sidebands before it fades.'],
        [
            'Long releases keep voices allocated, so fast passages exhaust the eight voices and steal released voices mid-fade.',
        ],
        noExternalModulation
    ),
    op2_ratio: parameterGuidance(
        'Op2 frequency multiplier',
        'Sets op2 at this multiple of the note frequency; op2 modulates op1 in every algorithm, so it sets the spacing of op1’s sidebands.',
        0.5,
        8,
        [
            'op2 deviates op1 by op2_ratio × freq × op2_level Hz, so raising op2_ratio widens the spectrum at a fixed op2_level.',
        ],
        [
            'A non-integer op2_ratio against an integer op1_ratio puts the sidebands off the harmonic series, giving inharmonic partials that do not follow the played pitch.',
        ],
        noExternalModulation
    ),
    op2_level: parameterGuidance(
        'Op2 modulation index',
        'Sets how strongly op2 modulates op1: the index equals op2_level times op2’s envelope, and across 0 to 1 the first sideband rises steadily against the carrier.',
        0.1,
        1,
        [
            'Shaped over time by op2_attack, op2_decay, op2_sustain and op2_release, which therefore act as brightness envelopes.',
        ],
        [
            'Below about 0.1 the first sideband sits more than 26 dB under the carrier, so op1 sounds as an almost plain sine.',
        ],
        noExternalModulation
    ),
    op2_attack: parameterGuidance(
        'Op2 envelope attack time',
        'Sets how long op2’s modulation takes to rise to op2_level after note-on, i.e. how quickly op1’s sidebands come in.',
        0.001,
        0.5,
        [
            'Runs independently of op1_attack, so a slower op2_attack starts the note close to a sine and lets it brighten.',
        ],
        [
            'An op2_attack longer than the note never reaches op2_level, so short notes sound duller than held ones at the same setting.',
        ],
        noExternalModulation
    ),
    op2_decay: parameterGuidance(
        'Op2 envelope decay time',
        'Sets how quickly op2’s modulation falls from its peak to op2_sustain, i.e. how fast the initial brightness fades.',
        0.05,
        2,
        ['Has no effect when op2_sustain is 1.'],
        ['With op2_sustain near 0, a short op2_decay leaves op1 an unmodulated sine for the rest of the note.'],
        noExternalModulation
    ),
    op2_sustain: parameterGuidance(
        'Op2 envelope sustain level',
        'Sets the modulation index op2 holds while the key is down, as a fraction of op2_level.',
        0,
        0.8,
        ['op2_decay sets how fast it is reached, and it multiplies op2_level.'],
        ['At 1 the full op2_level index persists for the whole note, so a held note stays as bright as its onset.'],
        noExternalModulation
    ),
    op2_release: parameterGuidance(
        'Op2 envelope release time',
        'Sets how long op2’s modulation fades after note-off.',
        0.05,
        3,
        [
            'Only audible while op1_release keeps op1 sounding; any part longer than op1_release is cut off by op1’s fade.',
        ],
        [
            'An op2_release much shorter than op1_release strips op1’s sidebands at note-off, so the tail turns into a plain sine.',
        ],
        noExternalModulation
    ),
    op3_ratio: parameterGuidance(
        'Op3 frequency multiplier',
        'Sets op3 at this multiple of the note frequency; op3 modulates op2 in algorithms 0 and 1, modulates op1 in algorithm 2, and is heard as a second carrier in algorithm 3.',
        0.5,
        8,
        [
            'In algorithm 3 op3_ratio sets that carrier’s pitch against op1_ratio, so unequal values sound two pitches at once.',
        ],
        [
            'In algorithm 3 op3 is heard directly, so a ratio of 16 puts an audible carrier above the Nyquist limit of a 44.1 kHz rate for notes above about 1.4 kHz.',
        ],
        noExternalModulation
    ),
    op3_level: parameterGuidance(
        'Op3 modulation index or second-carrier level',
        'Sets op3’s modulation index (0 to 1) in algorithms 0 to 2 and its output level in algorithm 3.',
        0.1,
        1,
        ['Its meaning follows algorithm: as a carrier in algorithm 3 it is summed with op1 at half level.'],
        [
            'Switching algorithm between 3 and the others turns a carrier level into a modulation index, so the same value changes from loudness to brightness.',
        ],
        noExternalModulation
    ),
    op3_attack: parameterGuidance(
        'Op3 envelope attack time',
        'Sets how quickly op3’s modulation, or its level in algorithm 3, rises after note-on.',
        0.001,
        0.5,
        ['In algorithms 0 and 1 it shapes how op2 itself is modulated, so it reaches op1 only through op2_level.'],
        [
            'An op3_attack longer than the note never reaches op3_level, so short notes miss the timbre the setting implies.',
        ],
        noExternalModulation
    ),
    op3_decay: parameterGuidance(
        'Op3 envelope decay time',
        'Sets how quickly op3 falls from its peak to op3_sustain.',
        0.05,
        2,
        ['Has no effect when op3_sustain is 1.'],
        [
            'With op3_sustain near 0, a short op3_decay removes op3’s contribution after the onset (the second carrier, in algorithm 3).',
        ],
        noExternalModulation
    ),
    op3_sustain: parameterGuidance(
        'Op3 envelope sustain level',
        'Sets the fraction of op3_level op3 holds while the key is down.',
        0,
        0.8,
        ['op3_decay sets how fast it is reached.'],
        [
            'At 1 in algorithm 3, op3 holds its full carrier level beside op1 for the whole note, raising the sustained output.',
        ],
        noExternalModulation
    ),
    op3_release: parameterGuidance(
        'Op3 envelope release time',
        'Sets how long op3 fades after note-off.',
        0.05,
        3,
        ['In algorithm 3 it is a carrier release and shapes the tail alongside op1_release.'],
        ['In algorithm 3 a long op3_release keeps a second pitch sounding after op1 has faded.'],
        noExternalModulation
    ),
    op4_ratio: parameterGuidance(
        'Op4 frequency multiplier',
        'Sets op4 at this multiple of the note frequency; op4 modulates op3 in algorithms 0, 2 and 3 and modulates op2 in algorithm 1.',
        0.5,
        8,
        [
            'op4 deviates the operator it feeds by op4_ratio × freq × op4_level Hz, and that operator passes the widened spectrum on through op3_level or op2_level.',
        ],
        [
            'At the top of the algorithm 0 cascade a high op4_ratio feeds sidebands through every lower operator, compounding op1’s bandwidth so the highest components fold past Nyquist on upper notes.',
        ],
        noExternalModulation
    ),
    op4_level: parameterGuidance(
        'Op4 modulation index',
        'Sets how strongly op4 modulates the operator it feeds (op3, or op2 in algorithm 1), from 0 to 1.',
        0.1,
        1,
        ['Heard only through op3_level (op2_level in algorithm 1): with that operator at 0, op4_level has no effect.'],
        [
            'Below about 0.1 op4’s sidebands sit more than 26 dB under the operator it modulates, so the control appears to do nothing.',
        ],
        noExternalModulation
    ),
    op4_attack: parameterGuidance(
        'Op4 envelope attack time',
        'Sets how quickly op4’s modulation rises after note-on.',
        0.001,
        0.5,
        [
            'Its effect reaches op1 only through the operators between them, so it is scaled by op3_level and op2_level in the cascade.',
        ],
        ['An op4_attack longer than the note never reaches op4_level, so its modulation is missing from short notes.'],
        noExternalModulation
    ),
    op4_decay: parameterGuidance(
        'Op4 envelope decay time',
        'Sets how quickly op4 falls from its peak to op4_sustain.',
        0.05,
        2,
        ['Has no effect when op4_sustain is 1.'],
        [
            'With op4_sustain near 0, a short op4_decay leaves op4’s modulation on the onset only, so the deepest part of a cascade disappears after it.',
        ],
        noExternalModulation
    ),
    op4_sustain: parameterGuidance(
        'Op4 envelope sustain level',
        'Sets the fraction of op4_level op4 holds while the key is down.',
        0,
        0.8,
        ['op4_decay sets how fast it is reached.'],
        [
            'At 1 op4 keeps its full index for the whole note, so the widest spectrum of the cascade persists through held notes.',
        ],
        noExternalModulation
    ),
    op4_release: parameterGuidance(
        'Op4 envelope release time',
        'Sets how long op4 fades after note-off.',
        0.05,
        3,
        ['Only audible while a carrier release (op1_release, and op3_release in algorithm 3) keeps output sounding.'],
        [
            'An op4_release longer than every carrier release only keeps a modulator of a silent carrier running, yet the descriptor still counts it in the instrument tail, lengthening exports.',
        ],
        noExternalModulation
    ),
    gain: parameterGuidance(
        'Per-voice velocity level',
        'Scales the whole voice output; each note-on overwrites it on that voice with velocity/127.',
        0.4,
        1,
        ['Multiplies the carrier output after op1_level, so it changes loudness but not the FM indices.'],
        [
            'A value written from the inspector or an automation lane reaches every allocated voice but lasts only until that voice’s next note-on.',
        ],
        noExternalModulation
    ),
    freq: parameterGuidance(
        'Per-voice note frequency',
        'Sets the base frequency every operator ratio multiplies; each note-on overwrites it with the played MIDI pitch.',
        27.5,
        4186,
        [
            'Every operator runs at its ratio times freq, so op1_ratio and the modulator ratios decide which multiples of freq sound.',
        ],
        [
            'Writing freq from automation retunes every sounding voice to one frequency at once, collapsing a chord until each voice’s next note-on.',
        ],
        noExternalModulation
    ),
    gate: parameterGuidance(
        'Per-voice trigger for all four operator envelopes',
        'Starts (1) or releases (0) all four operator envelopes; note-on and note-off set it on the voice that plays the note.',
        0,
        0,
        ['Writing gate 0 sends every voice into op1_release through op4_release; the attacks restart when it rises.'],
        [
            'Writing gate 1 reopens every allocated voice at once, including voices note-off already released, and they hold at their sustain levels until a later gate 0 write such as the transport stop’s all-notes-off.',
        ],
        noExternalModulation
    ),
};
