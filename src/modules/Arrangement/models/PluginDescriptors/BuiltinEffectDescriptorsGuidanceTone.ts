import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, effectGuidance } from './GuidanceProfiles';

/**
 * Per-parameter guidance declarations for the built-in tone-family effect
 * descriptors: EQ, filtering, distortion, and bitcrushing.
 *
 * Split out of BuiltinEffectDescriptorsGuidance.ts, which the whole built-in
 * guidance table would otherwise exceed the repository's max-lines ceiling
 * to hold in one file; BuiltinEffectDescriptorsGuidance.ts spreads this
 * table together with its Dynamics and TimeAndSpace counterparts and
 * re-exports the combined table. This file owns only guidance data, never
 * descriptor parameter shape. A new tone-family device's guidance belongs
 * here.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_TONE = [
    descriptorGuidance(
        'builtin-eq',
        effectGuidance(
            'Shape tonal balance with modest, source-specific band moves.',
            ['Start with cuts or moves within ±6 dB, then level-match bypass before judging.'],
            ['Band frequency selects the area, Q sets its width, and gain sets the amount of change.'],
            ['Narrow boosts can ring, exaggerate resonances, and consume headroom.'],
            {
                availability: 'unavailable',
                reason: 'EQ has no automatic output compensation; level-match bypass manually.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'eq-low-gain': parameterGuidance(
                'Low-band gain',
                'Boosts or cuts the low-frequency foundation of the source.',
                -4,
                4,
                [
                    'eq-low-freq sets where this acts and eq-low-q sets how tightly: dial in eq-low-freq and eq-low-q before pushing eq-low-gain far from zero.',
                ],
                ['Large boosts build mud against a kick or bass on the same band.'],
                noExternalModulation
            ),
            'eq-low-freq': parameterGuidance(
                'Low-band center frequency',
                'Selects the bass region that the low band shapes.',
                60,
                180,
                [
                    'eq-low-gain sets how much changes here and eq-low-q sets how tightly: nail this center before raising eq-low-gain or narrowing eq-low-q.',
                ],
                ['Very low centers can mask kick and bass fundamentals.'],
                noExternalModulation
            ),
            'eq-low-q': parameterGuidance(
                'Low-band Q',
                'Sets how narrowly the low-band gain targets the bass region.',
                0.5,
                2,
                [
                    'eq-low-freq places the center this width surrounds, and eq-low-gain sets the amount it narrows: raise eq-low-q only after eq-low-gain is set.',
                ],
                ['A narrow eq-low-q with a large boost can ring or boom at the center frequency.'],
                noExternalModulation
            ),
            'eq-mid-gain': parameterGuidance(
                'Mid-band gain',
                'Boosts or cuts the selected midrange emphasis.',
                -6,
                6,
                [
                    'eq-mid-freq selects the material this changes and eq-mid-q sets its focus: set eq-mid-freq and eq-mid-q before pushing this far.',
                ],
                ['Boosts can add harshness and use output headroom.'],
                noExternalModulation
            ),
            'eq-mid-freq': parameterGuidance(
                'Mid-band center frequency',
                'Selects the midrange region that the mid band shapes.',
                400,
                4000,
                [
                    'eq-mid-gain sets the amount applied here and eq-mid-q sets its width: choose this center before dialing in eq-mid-gain.',
                ],
                ['Placing this near vocal presence with a large cut can dull intelligibility.'],
                noExternalModulation
            ),
            'eq-mid-q': parameterGuidance(
                'Mid-band Q',
                'Sets how narrowly the mid-band gain is focused.',
                0.7,
                3,
                [
                    'eq-mid-freq places the center this narrows around, and eq-mid-gain sets the amount: widen eq-mid-q before eq-mid-gain reaches extremes.',
                ],
                ['A narrow eq-mid-q with a strong cut can sound phasey or nasal.'],
                noExternalModulation
            ),
            'eq-high-gain': parameterGuidance(
                'High-band gain',
                'Boosts or cuts top-end air and sheen.',
                -4,
                6,
                [
                    'eq-high-freq sets where this acts and eq-high-q sets how tightly: set eq-high-freq before pushing eq-high-gain.',
                ],
                ['Boosts above a few dB can add sibilance or amplify noise floor.'],
                noExternalModulation
            ),
            'eq-high-freq': parameterGuidance(
                'High-band center frequency',
                'Selects the treble region that the high band shapes.',
                6000,
                14000,
                [
                    'eq-high-gain sets the amount changed here and eq-high-q sets its width: choose this center before raising eq-high-gain.',
                ],
                ['Too low a corner can dull the midrange presence instead of adding air.'],
                noExternalModulation
            ),
            'eq-high-q': parameterGuidance(
                'High-band Q',
                'Sets how narrowly the high-band gain is focused.',
                0.5,
                3,
                [
                    'eq-high-freq places the center this narrows and eq-high-gain sets the amount: use with eq-high-freq and eq-high-gain.',
                ],
                ['High eq-high-q can isolate and exaggerate a harsh resonance.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-filter',
        effectGuidance(
            'Shape spectral balance with a resonant filter.',
            ['Raise resonance gradually and level-match after strong filtering.'],
            ['Cutoff selects the transition region; resonance emphasizes it; type selects topology.'],
            ['High resonance can whistle or overemphasize a narrow frequency.'],
            { availability: 'unavailable', reason: 'This filter declares no automatic output compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'filter-cutoff': parameterGuidance(
                'Filter cutoff frequency',
                'Sets the frequency where the selected filter topology begins acting.',
                200,
                4000,
                [
                    'filter-resonance emphasizes the region around this cutoff and filter-type sets the topology: set filter-type before sweeping filter-cutoff.',
                ],
                ['Sweeping cutoff with high filter-resonance can produce a loud whistling peak.'],
                noExternalModulation
            ),
            'filter-resonance': parameterGuidance(
                'Filter resonance amount',
                'Sets how much the filter emphasizes the region at the cutoff.',
                0.5,
                3,
                [
                    'filter-cutoff sets the frequency this emphasizes: keep filter-resonance moderate while sweeping filter-cutoff.',
                ],
                ['High resonance can overemphasize a narrow frequency, producing audible ringing.'],
                noExternalModulation
            ),
            'filter-type': parameterGuidance(
                'Filter topology selector',
                'Chooses which frequencies the filter removes relative to the cutoff.',
                0,
                0,
                [
                    'filter-cutoff and filter-resonance apply relative to whichever topology this selects: choose filter-type before tuning filter-cutoff and filter-resonance.',
                ],
                ['Switching topology while automation drives filter-cutoff can produce an abrupt tonal jump.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-distortion',
        effectGuidance(
            'Add harmonic saturation while staging output into later devices.',
            ['Lower output after increasing drive and compare bypass at matched level.'],
            ['Drive creates harmonics; tone filters them; output and mix set level and blend.'],
            ['High drive can alias, lose transients, and overload later stages.'],
            { availability: 'unavailable', reason: 'This distortion declares no automatic loudness matching.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'dist-drive': parameterGuidance(
                'Distortion drive amount',
                'Sets how much the signal overdrives into harmonic saturation.',
                10,
                40,
                [
                    'dist-tone shapes the harmonics this generates and dist-output stages the result: set dist-drive before dist-tone and dist-output.',
                ],
                ['High drive can alias and strip transients before later devices even see the signal.'],
                noExternalModulation
            ),
            'dist-tone': parameterGuidance(
                'Distortion tone filter',
                'Sets the brightness of the generated harmonic content.',
                1500,
                4500,
                [
                    'dist-drive sets how much harmonic content this filters and dist-mix sets its audibility: adjust dist-tone after setting dist-drive.',
                ],
                ['A bright dist-tone with high dist-drive can sound harsh and fatiguing.'],
                noExternalModulation
            ),
            'dist-output': parameterGuidance(
                'Distortion output trim',
                'Lowers the level after saturation to stage into later devices.',
                -12,
                -2,
                [
                    'dist-drive raises level that this trims back down: lower dist-output after raising dist-drive to level-match against bypass.',
                ],
                ['Insufficient dist-output trim after heavy dist-drive can overload later stages.'],
                noExternalModulation
            ),
            'dist-mix': parameterGuidance(
                'Distortion wet/dry blend',
                'Sets the proportion of distorted signal blended with the clean source.',
                0.3,
                0.7,
                [
                    'dist-drive sets the character this proportion of signal carries: set dist-drive and dist-tone before dist-mix.',
                ],
                ['High wet mix on a clean source loses all of the original transient.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-bitcrusher',
        effectGuidance(
            'Reduce resolution for deliberate digital texture.',
            ['Blend wet signal conservatively and reduce output if harshness increases level.'],
            ['Bit depth and sample rate set degradation; mix sets blend.'],
            ['Extreme reduction can add harsh aliases and obscure pitch.'],
            { availability: 'unavailable', reason: 'This bitcrusher declares no automatic loudness compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'crush-bits': parameterGuidance(
                'Bitcrusher bit depth',
                'Sets the quantization resolution, adding grit as it drops.',
                4,
                8,
                [
                    'crush-rate sets the other axis of degradation alongside this: lower crush-bits before crush-rate for a controlled lo-fi texture.',
                ],
                ['Very low bit depth can obscure pitch and add harsh quantization noise.'],
                noExternalModulation
            ),
            'crush-rate': parameterGuidance(
                'Bitcrusher sample-rate reduction',
                'Sets how much the effective sample rate drops, adding aliased artifacts.',
                2,
                15,
                [
                    'crush-bits sets the other axis of degradation alongside this: combine crush-rate with crush-bits for the intended texture.',
                ],
                ['High rate reduction creates harsh aliased frequencies that can obscure pitch.'],
                noExternalModulation
            ),
            'crush-mix': parameterGuidance(
                'Bitcrusher wet blend',
                'Sets the proportion of degraded signal blended with the clean source.',
                0.2,
                0.6,
                ['crush-bits and crush-rate set the character this proportion carries: set those before crush-mix.'],
                ['High wet mix at extreme crush-bits settings can raise perceived noise floor.'],
                noExternalModulation
            ),
        }
    ),
];
