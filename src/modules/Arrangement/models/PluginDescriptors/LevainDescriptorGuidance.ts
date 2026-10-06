import { type DeviceParameterGuidance } from '../DeviceParameterTypes';

import { parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, instrumentGuidance } from './GuidanceProfiles';

/**
 * Guidance for Levain, taken from `crates/daw-dsp/src/levain`.
 *
 * `LevainEngine::set_param` (`engine.rs`) maps the descriptor ids through
 * `PARAM_MAP` (`services/levainProcessor.ts`). A note's gain is fixed at its
 * note-on as velocity/127 × the humanize level offset × the auto-divisi
 * gain; `masterGain` and the mod-wheel expression gain scale each mic
 * position's voice sum afterwards. Humanize and vibrato limits quoted below
 * are the shipped patch defaults (`LevainPatch.ts`), which a patch can change.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const LEVAIN_GUIDANCE = instrumentGuidance(
    'Play a multi-sampled section instrument with legato transitions, per-note humanisation, vibrato and mic-position mixing; it plays a fallback sine until its samples load.',
    [
        'legatoEnabled is on by default and turns overlapping notes within an octave into transitions of one voice, so switch it off for chordal parts.',
    ],
    [
        'humanize and vibratoDepth vary each new note, autoDivisi lowers each new note by the number of notes held, and masterGain scales every mic position before the realism and tone stages.',
    ],
    ['ensembleTiming is stored but no engine stage reads it, so enabling it changes nothing audible.']
);

export const LEVAIN_PARAMETER_GUIDANCE: Readonly<Record<string, DeviceParameterGuidance>> = {
    masterGain: parameterGuidance(
        'Output gain per mic position',
        'Multiplies each mic position’s summed voices, together with the mod-wheel expression gain, before the realism layer and tone macro.',
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
        'Scales the random offsets each new note receives; at 1 that is a start delay of up to 15 ms (applied only when the random offset is positive), up to 5 cents of tuning, up to 8 percent of level, up to 15 percent of vibrato rate and depth, and up to 64 samples of sample-start offset.',
        0.2,
        0.7,
        [
            'Its vibrato offsets scale the vibrato vibratoDepth sets, and its level offset multiplies velocity before autoDivisi’s divisi gain.',
        ],
        [
            'At 1 notes meant to land together can start up to 15 ms apart and up to 5 cents out of tune with each other, which is heard as flams on tight rhythmic parts.',
        ],
        noExternalModulation
    ),
    vibratoDepth: parameterGuidance(
        'Section vibrato depth and rate macro',
        'Moves vibrato from none to 40 cents of depth while raising its rate from 4 to 7 Hz, after a 0.2 s onset delay; the value is quantised to 128 steps.',
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
            'Turn it off for chords: with it on, autoDivisi still counts each overlapping note, but the glided notes reuse the earlier voice instead of sounding beside it.',
        ],
        [
            'With it on, block chords within an octave collapse: each later chord note takes over a held voice, so the earlier note stops sounding.',
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
        'Ensemble timing switch with no engine consumer',
        'Stores a flag the engine never reads: no attack spread, pitch convergence or bloom is applied, whatever its value.',
        0,
        0,
        [
            'Use humanize for per-note timing and tuning variation; it is the control that actually offsets note starts and pitch.',
        ],
        [
            'Turning it on changes nothing audible, so a part relying on it for ensemble looseness gets no timing spread from it.',
        ],
        noExternalModulation
    ),
};
