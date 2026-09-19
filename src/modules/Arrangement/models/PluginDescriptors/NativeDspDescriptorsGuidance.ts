import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, effectGuidance, referenceSignalGuidance } from './GuidanceProfiles';

/**
 * Per-parameter guidance declarations for the native DSP effect descriptors
 * (Dutch Oven, native scoring).
 *
 * Split out of NativeDspDescriptors.ts to keep both files under the
 * repository's max-lines ceiling; this file owns only the guidance data,
 * never descriptor parameter shape.
 */

export const NATIVE_DSP_DESCRIPTORS_GUIDANCE = [
    descriptorGuidance(
        'dutch-oven',
        effectGuidance(
            'Build a spacious reverb tail, then tune damping and wet level in the context of the arrangement.',
            ['Keep wet level and decay conservative while checking low-frequency build-up.'],
            ['Algorithm, decay, damping, diffusion, and modulation jointly determine the tail character.'],
            ['Long bright or frozen tails can mask timing and accumulate energy.'],
            {
                availability: 'not-applicable',
                reason: 'This reverb declares no automatic wet-path output compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            mix: parameterGuidance(
                'Dutch Oven wet mix',
                'Sets the proportion of the generated reverb blended with the dry source.',
                0.15,
                0.4,
                ['decay and size set the character this proportion carries: balance mix after decay and size are set.'],
                ['High wet mix on a long decay can push a source far behind the arrangement.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            decay: parameterGuidance(
                'Dutch Oven decay coefficient',
                'Sets how long the tail rings before it fades to silence, mapped through the active algorithm.',
                0.3,
                0.6,
                [
                    'algorithm sets which engine converts this coefficient into a tail length: check algorithm before judging how far decay reaches.',
                ],
                ['Long decay near the top of the range can build low-frequency density and mask timing.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            damping: parameterGuidance(
                'Dutch Oven high-frequency damping',
                'Sets how quickly high frequencies fade within the tail, independent of decay.',
                0.15,
                0.45,
                [
                    'decay sets the overall tail length that damping shapes the brightness of: raise damping to tame a bright decay.',
                ],
                ['Low damping on a long decay can leave a harsh, metallic tail on the plate and spring algorithms.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            predelay: parameterGuidance(
                'Dutch Oven pre-delay',
                'Sets the gap between the dry source and the first reflection.',
                10,
                60,
                [
                    'mix sets how audible the delayed tail this creates is: raise predelay to separate the source from a dense mix setting.',
                ],
                ['Long pre-delay can detach the tail from the source and sound like a separate echo.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            size: parameterGuidance(
                'Dutch Oven room size',
                'Sets the perceived size of the simulated space.',
                0.4,
                0.8,
                ['decay sets how long this space rings and diffusion sets its density: set size before tuning decay.'],
                ['A large size with long decay can build low-frequency density in a dense mix.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            mod_rate: parameterGuidance(
                'Dutch Oven modulation rate',
                'Sets how fast the internal pitch modulation moves within the tail.',
                0.3,
                1.5,
                [
                    'mod_depth sets how far this rate sweeps: raise mod_rate only after mod_depth is set to keep the tail stable.',
                ],
                ['Fast rates with deep mod_depth can sound seasick or detune the tail noticeably.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            mod_depth: parameterGuidance(
                'Dutch Oven modulation depth',
                'Sets how far the internal pitch modulation sweeps, thickening the tail.',
                0.1,
                0.4,
                ['mod_rate sets how fast this sweep travels: balance mod_depth against mod_rate.'],
                ['Deep modulation can introduce audible pitch wobble on sustained sources.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            diffusion: parameterGuidance(
                'Dutch Oven diffusion amount',
                'Sets how quickly individual echoes smear into a continuous wash.',
                0.5,
                0.9,
                [
                    'size sets the space this smears within and density sets echo count: raise diffusion after size is set.',
                ],
                ['Low diffusion can leave audible discrete echoes rather than a smooth wash.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            high_cut: parameterGuidance(
                'Dutch Oven tail high cut',
                'Darkens the tail above this frequency, reducing perceived brightness.',
                5000,
                10000,
                [
                    "low_cut sets the other edge of the tail's tone: set high_cut and low_cut together to shape the reverb band.",
                ],
                ['Too aggressive a cut can make the tail sound muffled on bright sources.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            low_cut: parameterGuidance(
                'Dutch Oven tail low cut',
                'Removes low-frequency content from the tail before it sums with the source.',
                60,
                200,
                [
                    "high_cut sets the other edge of the tail's tone: raise low_cut before raising mix on bass-heavy sources.",
                ],
                ['Too little low cut lets the tail build mud under a bass-heavy source.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            width: parameterGuidance(
                'Dutch Oven stereo width',
                'Sets how wide the generated tail spreads across the stereo field.',
                0.7,
                1.3,
                [
                    'diffusion sets how dense the tail this widens is: raise width after diffusion is set for a stable spread.',
                ],
                ['Extreme width can destabilize the tail in mono playback.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            freeze: parameterGuidance(
                'Dutch Oven freeze',
                'Sustains the current tail indefinitely instead of letting it decay.',
                0,
                0,
                [
                    'shimmer is silenced for as long as freeze stays engaged, regardless of its own setting, and resumes once freeze clears.',
                ],
                ['Leaving freeze engaged can sustain audio indefinitely and go unnoticed in a mix.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            shimmer: parameterGuidance(
                'Dutch Oven shimmer enable',
                'Adds a pitched octave layer that regenerates within the tail.',
                0,
                0,
                [
                    'shimmer_amount sets how much pitched layer this adds and shimmer_pitch sets its interval: set shimmer_amount after enabling shimmer.',
                ],
                ['Shimmer with a long decay can build an unintended droning layer.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            shimmer_amount: parameterGuidance(
                'Dutch Oven shimmer amount',
                'Sets how much of the pitched shimmer layer blends into the tail.',
                0.1,
                0.35,
                [
                    'shimmer enables the layer this sets the amount of, and shimmer_pitch sets its interval: raise shimmer_amount only after shimmer is enabled.',
                ],
                ["High shimmer amount can overwhelm the source's original pitch character."],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            shimmer_pitch: parameterGuidance(
                'Dutch Oven shimmer pitch interval',
                'Switches the shimmer layer between a fifth interval below 0.5 and an octave interval at 0.5 and above.',
                0.5,
                1,
                [
                    'shimmer_amount sets how audible this interval choice is: pick shimmer_pitch before raising shimmer_amount.',
                ],
                ['An unfamiliar interval choice can clash harmonically with the source material.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            gravity: parameterGuidance(
                'Dutch Oven gravity',
                'Tilts the tank allpass gain to swell energy later in the tail below 0.5, or let it decay normally at and above 0.5; 0.5 is neutral.',
                0.3,
                0.7,
                [
                    'decay sets the per-pass gain this tilts: set decay before dialing gravity away from its neutral 0.5.',
                ],
                ['Extreme gravity settings can push the tail into an unnatural, artificial character.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            saturation: parameterGuidance(
                'Dutch Oven saturation enable',
                'Enables harmonic saturation on the tail for added warmth or grit.',
                0,
                0,
                ['saturation_type selects the curve applied when saturation is enabled.'],
                ['Saturation on a long decay can add audible distortion that builds through the tail.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            saturation_type: parameterGuidance(
                'Dutch Oven saturation curve',
                'Selects the harmonic saturation curve applied to the tail: 0 is the soft, default tanh curve, 1 adds third-harmonic content, and 2 hard-clips.',
                0,
                1,
                ['saturation must be enabled for saturation_type to take effect.'],
                ['Switching curves on a sustained tail can produce an audible timbral jump.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            early_late: parameterGuidance(
                'Dutch Oven early/late balance',
                'Balances early reflections against the late diffuse tail.',
                0.2,
                0.5,
                ['diffusion sets how the late portion this balances is built: set diffusion before tuning early_late.'],
                ['Favoring early reflections too heavily can sound like a short slap rather than a space.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            density: parameterGuidance(
                'Dutch Oven diffusion cross-coupling',
                "Sets how strongly the tank's two delay halves cross-couple, thickening the diffusion of the tail; 1.0 is the neutral default.",
                0.7,
                1,
                [
                    'diffusion sets the overall smear this cross-coupling thickens: set diffusion before lowering density.',
                ],
                ['Lowering density below its neutral default thins the tail and makes it less diffuse.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            decay_eq_0: parameterGuidance(
                'Decay-rate EQ, low-frequency band (~100 Hz)',
                'Multiplies the decay time of the low-frequency band, independent of the other bands.',
                0.5,
                2,
                [
                    "decay_eq_1 sets the neighboring low-mid band's multiplier: shape decay_eq_0 relative to decay_eq_1 to avoid an abrupt low-end transition.",
                ],
                ["Raising this band's multiplier well above 1x can build boomy low-frequency sustain."],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            decay_eq_1: parameterGuidance(
                'Decay-rate EQ, low-mid band (~400 Hz)',
                'Multiplies the decay time of the low-mid band, independent of the other bands.',
                0.5,
                2,
                [
                    "decay_eq_0 and decay_eq_2 set the neighboring bands' multipliers: keep decay_eq_1 close to its neighbors for a smooth decay curve.",
                ],
                ['A large mismatch against decay_eq_0 can create an audible seam in the tail.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            decay_eq_2: parameterGuidance(
                'Decay-rate EQ, mid band (~1200 Hz)',
                'Multiplies the decay time of the midrange band, independent of the other bands.',
                0.4,
                1.8,
                [
                    "decay_eq_1 and decay_eq_3 set the neighboring bands' multipliers: shape decay_eq_2 relative to both to keep the tail's midrange smooth.",
                ],
                ["Lowering this multiplier far below 1x can make the tail's midrange decay unnaturally fast."],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            decay_eq_3: parameterGuidance(
                'Decay-rate EQ, upper-mid band (~3500 Hz)',
                'Multiplies the decay time of the upper-midrange band, independent of the other bands.',
                0.4,
                1.8,
                [
                    "decay_eq_2 and decay_eq_4 set the neighboring bands' multipliers: keep decay_eq_3 between them for a smooth spectral tilt.",
                ],
                ['Raising this multiplier well above its neighbors can make the tail sound harsh late in its decay.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            decay_eq_4: parameterGuidance(
                'Decay-rate EQ, high-frequency band (~8000 Hz)',
                'Multiplies the decay time of the high-frequency band, independent of the other bands.',
                0.3,
                1.5,
                [
                    "decay_eq_3 and decay_eq_5 set the neighboring bands' multipliers: lower decay_eq_4 relative to decay_eq_3 for a naturally darkening tail.",
                ],
                ['Raising this multiplier above 1x can leave an unnaturally bright tail that outlasts damping.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            decay_eq_5: parameterGuidance(
                'Decay-rate EQ, air band (~12000 Hz)',
                'Multiplies the decay time of the topmost air band, independent of the other bands.',
                0.3,
                1.2,
                [
                    "decay_eq_4 sets the neighboring high-frequency band's multiplier: keep decay_eq_5 at or below decay_eq_4 for a natural high-frequency rolloff.",
                ],
                ['Raising this multiplier well above decay_eq_4 can produce an unnatural hiss-like tail.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            algorithm: parameterGuidance(
                'Dutch Oven algorithm selector',
                'Chooses which reverb engine renders the tail, changing its fundamental character.',
                0,
                3,
                [
                    'decay sets the tail length this engine renders and vintage colors its output: choose algorithm before tuning decay.',
                ],
                ['Switching algorithm mid-project changes the fundamental tail character, not just its length.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            vintage: parameterGuidance(
                'Dutch Oven vintage character',
                'Applies a coloration stage modeled after a vintage reverb unit to the output: 0 is the clean, unprocessed mode, and 1 and 2 add progressively stronger band-limiting and a noise floor.',
                0,
                1,
                ['algorithm sets the tail this coloration is applied to: choose algorithm before selecting vintage.'],
                ['A strong vintage setting can noticeably darken or color a bright algorithm.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
        }
    ),
    descriptorGuidance(
        'native-scoring',
        referenceSignalGuidance(
            'Generate a reference pitch for tuning and calibration rather than musical processing.',
            ['Mute the reference output before delivery or recording.'],
            ['Reference frequency and tone enable together determine the emitted calibration signal.'],
            ['An enabled reference tone can be unexpectedly audible in a mix.'],
            { availability: 'not-applicable', reason: 'This utility has no automatic audio-level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            a4_hz: parameterGuidance(
                'Reference pitch standard',
                'Sets the frequency treated as A4 for tuning and pitch measurement.',
                438,
                444,
                [
                    'tone sets whether this reference frequency is actually emitted as audio: enable tone to hear a4_hz before trusting a pitch reading.',
                ],
                [
                    'A non-standard reference away from 440 Hz can make pitch readings appear off to musicians expecting concert pitch.',
                ],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            mute: parameterGuidance(
                'Scoring output mute',
                "Silences the module's own audio output while it continues measuring.",
                0,
                0,
                [
                    'tone determines whether there is anything to mute: enable mute whenever tone would otherwise be audible in the mix.',
                ],
                [
                    'Leaving mute disabled with tone enabled can make the reference tone audible in a recording or export.',
                ],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
            tone: parameterGuidance(
                'Reference tone enable',
                'Generates an audible calibration tone at the reference pitch.',
                0,
                0,
                [
                    'a4_hz sets the pitch this tone is generated at, and mute silences it: set a4_hz before enabling tone, then mute before delivery.',
                ],
                ['An enabled tone left unmuted can be unexpectedly audible during playback or export.'],
                NO_SOURCE_SPECIFIC_MODULATION
            ),
        }
    ),
];
