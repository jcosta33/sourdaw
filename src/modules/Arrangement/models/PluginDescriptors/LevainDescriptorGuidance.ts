import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for Levain, taken from `crates/daw-dsp/src/levain`.
 *
 * `LevainEngine::set_param` (`engine.rs`) maps the descriptor ids through
 * `PARAM_MAP` (`services/levainProcessor.ts`). A note's gain is fixed at its
 * note-on as velocity/127 × the humanize level offset × the auto-divisi
 * gain; `masterGain` and the expression gain (CC11 expression × CC7 volume,
 * `expression.rs` `expression_gain`) scale each mic position's voice sum
 * afterwards. The mod wheel (CC1) drives the dynamic-layer crossfade, not
 * level. Humanize and vibrato limits quoted below
 * are the shipped patch defaults (`LevainPatch.ts`), which a patch can change.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const LEVAIN_GUIDANCE = instrumentGuidance(
    'Play a multi-sampled section instrument with legato transitions, per-note humanisation, vibrato and mic-position mixing; it plays a fallback sine until its samples load.',
    [
        'legatoEnabled is on by default and lets an overlapping note within an octave take over the voice of the closest held note, so switch it off for chordal parts.',
    ],
    [
        'humanize varies each new note, vibratoDepth sets the vibrato of every sounding voice, autoDivisi lowers each new note by the number of notes held, and masterGain scales every mic position before the realism and tone stages.',
    ],
    [
        'ensembleTiming holds each fresh attack back by up to 12 ms, a fixed offset per pitch, so a part that must land exactly on the grid should leave it off.',
    ]
);

export const LEVAIN_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    masterGain: parameterGuidance(
        'Output gain per mic position',
        'Multiplies each mic position’s summed voices, together with the CC11 expression × CC7 volume gain, before the realism layer and tone macro.',
        0.4,
        1,
        [
            'Applies on top of the per-note gain that velocity, humanize and autoDivisi set, so it trims the whole instrument without changing their balance.',
        ],
        ['Above 1 it amplifies past the sample level with no limiter after it, so loud dynamics can clip downstream.'],
        noExternalModulation
    ),
    humanize: parameterGuidance(
        'Per-note random variation amount',
        'Scales the random offsets each new note receives; at 1 that is a start delay of up to 15 ms (applied only when the random offset is positive), a tuning offset of plus or minus 5 cents, a level offset of plus or minus 8 percent, plus or minus 15 percent of vibrato rate and depth, and up to 64 samples of sample-start offset.',
        0.2,
        0.7,
        [
            'Its vibrato offsets scale the vibrato vibratoDepth sets, and its level offset multiplies velocity before autoDivisi’s divisi gain.',
        ],
        [
            'At 1 notes meant to land together can start up to 15 ms apart, and because each note draws its own plus or minus 5 cents, two notes can sit up to 10 cents apart in tuning.',
        ],
        noExternalModulation
    ),
    vibratoDepth: parameterGuidance(
        'Section vibrato depth and rate macro',
        'Moves vibrato from none to a 40-cent peak depth while raising its rate from 4 to 7 Hz, on every sounding voice each block, so a change or an automation lane reaches notes already held; each note fades its vibrato in linearly over the first 0.2 s, and the value is quantised to 128 steps.',
        0,
        0.6,
        [
            'humanize varies each voice’s vibrato rate and depth around this setting by up to 15 percent at full humanize.',
        ],
        [
            'Near 1 the vibrato reaches 40 cents of depth, close to half a semitone, which pulls sustained notes audibly off pitch in tuned ensemble parts.',
        ],
        noExternalModulation
    ),
    legatoEnabled: parameterGuidance(
        'Legato transition switch',
        'When on, a note that starts while a held note lies within 12 semitones plays as a transition from it: a recorded legato sample when the bank has one, otherwise a 30 to 80 ms glide of the held voice to the new pitch.',
        1,
        1,
        [
            'Turn it off for chords: with it on, autoDivisi still counts each overlapping note, but a note that glides reuses the earlier note’s voice instead of sounding beside it.',
        ],
        [
            'With it on, chord notes within an octave alternately replace and add: the glide takes over the closest held note’s voice and leaves the new note registered on an idle voice, so the next chord note finds that voice idle and starts normally. An ascending C-E-G sounds only E and G, and a four-note chord loses its first and third notes.',
        ],
        noExternalModulation
    ),
    autoDivisi: parameterGuidance(
        'Automatic divisi level scaling for chords',
        'When on, each new note’s level is scaled by 1/√n, where n is the number of notes held at its note-on (up to 16), as if the section split across the chord.',
        0,
        0,
        [
            'Applies to normal note starts; with legatoEnabled on, overlapping notes glide an existing voice instead and keep that voice’s level.',
        ],
        [
            'The scale is fixed at each note’s own note-on, so in a block chord the first note plays at full level, the second at −3 dB and the fourth at −6 dB, leaving the chord unbalanced.',
        ],
        noExternalModulation
    ),
    ensembleTiming: parameterGuidance(
        'Section attack-spread switch',
        'When on, each fresh attack starts up to 12 ms late by an offset fixed for its pitch, so notes struck together land a few milliseconds apart like a section’s players; the offset depends on the pitch alone, so live playback and an export delay a note by the same amount.',
        0,
        0,
        [
            'Adds to humanize’s random start delay rather than replacing it, and applies only to fresh attacks: with legatoEnabled on, a note that slurs from a held one keeps the slur’s timing.',
            'Only the attack spread is applied; it does not detune or swell the section.',
        ],
        [
            'Every note can start up to 12 ms after its grid position, which loosens tight rhythmic parts and shifts them against other tracks.',
        ],
        noExternalModulation
    ),
};
