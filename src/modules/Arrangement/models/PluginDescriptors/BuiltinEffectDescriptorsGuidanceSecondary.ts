import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, analysisGuidance, effectGuidance } from './GuidanceProfiles';

/**
 * Per-parameter guidance declarations for the second half of the built-in
 * effect descriptors (Distortion through the LUFS meter).
 *
 * Split out of BuiltinEffectDescriptorsGuidance.ts, which the whole built-in
 * guidance table would otherwise exceed the repository's max-lines ceiling
 * to hold in one file; BuiltinEffectDescriptorsGuidance.ts concatenates this
 * with its counterpart and re-exports the combined table. This file owns
 * only guidance data, never descriptor parameter shape.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_SECONDARY = [
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
        'builtin-limiter',
        effectGuidance(
            'Catch peaks near a chosen output ceiling.',
            ['Leave ceiling margin for later conversion and compare against bypass.'],
            ['Threshold drives reduction while release controls recovery and ceiling caps output.'],
            ['Heavy limiting can flatten transients and raise apparent loudness deceptively.'],
            { availability: 'unavailable', reason: 'This limiter declares no automatic loudness matching.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'lim-threshold': parameterGuidance(
                'Limiter threshold',
                'Sets the input level above which the limiter begins catching peaks.',
                -10,
                -2,
                [
                    'lim-ceiling sets the hard output cap this reduction aims for and lim-release sets recovery speed: drive lim-threshold down only after lim-ceiling is set.',
                ],
                ["Driving the threshold far below the program's peaks can flatten transients audibly."],
                noExternalModulation
            ),
            'lim-release': parameterGuidance(
                'Limiter release time',
                'Sets how quickly gain recovers after the limiter catches a peak.',
                30,
                150,
                [
                    'lim-threshold sets how often this recovery is triggered: match lim-release to program tempo once lim-threshold is set.',
                ],
                ['Very fast release can distort low-frequency peaks by recovering within a cycle.'],
                noExternalModulation
            ),
            'lim-ceiling': parameterGuidance(
                'Limiter output ceiling',
                'Sets the hard maximum output level the limiter will not exceed.',
                -1,
                -0.1,
                [
                    'lim-threshold sets how much reduction reaches this cap: set lim-ceiling before driving lim-threshold down.',
                ],
                ['A ceiling too close to 0 dB can clip on inter-sample peaks after conversion.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-flanger',
        effectGuidance(
            'Create short comb-filter motion for color.',
            ['Keep feedback restrained on full-range material.'],
            ['Rate and depth sweep the delay; feedback increases comb resonance.'],
            ['High feedback can cause metallic peaks and level build-up.'],
            { availability: 'not-applicable', reason: 'This flanger declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'flanger-rate': parameterGuidance(
                'Flanger sweep rate',
                'Sets how fast the short delay sweeps to create the comb-filter motion.',
                0.1,
                0.8,
                [
                    'flanger-depth sets how far this sweep travels and flanger-feedback sharpens the resulting comb: set flanger-depth before raising flanger-rate.',
                ],
                ['Fast rates with deep flanger-depth can sound like a siren rather than subtle motion.'],
                noExternalModulation
            ),
            'flanger-depth': parameterGuidance(
                'Flanger sweep depth',
                'Sets how far the short delay time sweeps, widening the comb spacing.',
                1,
                4,
                [
                    'flanger-rate sets how fast this sweep travels and flanger-feedback resonates the comb: balance flanger-depth against flanger-feedback.',
                ],
                ['Deep sweeps with high flanger-feedback can produce metallic peaks and level build-up.'],
                noExternalModulation
            ),
            'flanger-feedback': parameterGuidance(
                'Flanger resonance amount',
                'Sets how sharply the comb-filter notches resonate.',
                0.15,
                0.6,
                [
                    'flanger-depth sets the comb spacing this resonates and flanger-mix sets its audibility: raise flanger-feedback after flanger-depth is set.',
                ],
                ['High feedback can create sharp metallic peaks and a long, ringing resonance build-up.'],
                noExternalModulation
            ),
            'flanger-mix': parameterGuidance(
                'Flanger wet mix',
                'Sets the proportion of flanged signal blended with the dry source.',
                0.3,
                0.6,
                [
                    'flanger-depth and flanger-feedback set the character this proportion carries: set those first, then flanger-mix.',
                ],
                ['High wet mix at full flanger-feedback can sound harsh rather than subtle.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-tremolo',
        effectGuidance(
            'Impose rhythmic amplitude movement on a source.',
            ['Keep depth below full mute unless a hard chop is intentional.'],
            ['Rate sets rhythm, depth sets level movement, and shape sets contour.'],
            ['Full depth can remove note audibility between pulses.'],
            {
                availability: 'not-applicable',
                reason: 'This amplitude effect declares no automatic level compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'trem-rate': parameterGuidance(
                'Tremolo pulse rate',
                'Sets how fast the amplitude pulses.',
                1,
                8,
                [
                    'trem-depth sets how deep each pulse this rate creates goes: set trem-depth before tuning trem-rate to the tempo.',
                ],
                ['Fast rates with full trem-depth can sound like distortion rather than rhythm.'],
                noExternalModulation
            ),
            'trem-depth': parameterGuidance(
                'Tremolo pulse depth',
                'Sets how far the amplitude dips on each pulse.',
                0.2,
                0.7,
                [
                    'trem-rate sets the pulse this depth affects and trem-shape sets its contour: set trem-rate before pushing trem-depth toward full.',
                ],
                ['Full depth removes note audibility between pulses entirely.'],
                noExternalModulation
            ),
            'trem-shape': parameterGuidance(
                'Tremolo waveform shape',
                'Sets whether the amplitude pulse is a smooth sine or a hard on/off square.',
                0,
                0,
                [
                    'trem-rate and trem-depth set the rhythm this contour shapes: choose trem-shape after trem-rate and trem-depth are set.',
                ],
                ['Square shape at fast trem-rate can produce audible clicking at each transition.'],
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
                3,
                7,
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
        'builtin-autopan',
        effectGuidance(
            'Move a source across the stereo field rhythmically.',
            ['Check mono compatibility before using wide depth on critical material.'],
            ['Rate sets movement, depth sets width, and shape sets contour.'],
            ['Extreme depth can make a source unstable in mono.'],
            { availability: 'not-applicable', reason: 'This pan effect declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'autopan-rate': parameterGuidance(
                'Auto-pan sweep rate',
                'Sets how fast the source moves across the stereo field.',
                0.3,
                2,
                [
                    'autopan-depth sets how wide this sweep travels: set autopan-depth before tuning autopan-rate to the tempo.',
                ],
                ['Fast rates with deep autopan-depth can sound disorienting rather than musical.'],
                noExternalModulation
            ),
            'autopan-depth': parameterGuidance(
                'Auto-pan sweep width',
                'Sets how far left and right the source travels.',
                0.3,
                0.8,
                [
                    'autopan-rate sets how fast this width sweeps and autopan-shape sets its contour: balance autopan-depth against autopan-rate.',
                ],
                ['Full depth can make a source unstable or disappear entirely in mono.'],
                noExternalModulation
            ),
            'autopan-shape': parameterGuidance(
                'Auto-pan waveform shape',
                'Sets whether the pan sweep eases smoothly or moves at a constant rate between extremes.',
                0,
                0,
                [
                    'autopan-rate and autopan-depth set the sweep this contour shapes: choose autopan-shape after those are set.',
                ],
                ['Triangle shape at fast autopan-rate can sound abrupt at the stereo extremes.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-convolution-reverb',
        effectGuidance(
            'Place a source in an impulse-response space.',
            ['Use wet mix and pre-delay conservatively while checking arrangement masking.'],
            ['Impulse choice supplies character; filters and mix shape its placement.'],
            ['Long bright impulses can obscure rhythm and build low-frequency energy.'],
            {
                availability: 'not-applicable',
                reason: 'This convolution reverb declares no automatic wet-path compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'conv-ir': parameterGuidance(
                'Convolution impulse response selection',
                'Chooses the captured space that colors the reverb character.',
                0,
                3,
                [
                    'conv-mix sets how audible this chosen space is: choose conv-ir before tuning conv-mix and the tone filters.',
                ],
                ['Switching to a long, bright impulse without lowering conv-mix can suddenly dominate the mix.'],
                noExternalModulation
            ),
            'conv-mix': parameterGuidance(
                'Convolution wet mix',
                'Sets the proportion of the convolved signal blended with the dry source.',
                0.2,
                0.45,
                ['conv-ir sets the character this proportion carries: set conv-ir before tuning conv-mix.'],
                ['High wet mix with a long conv-ir can obscure rhythmic detail.'],
                noExternalModulation
            ),
            'conv-predelay': parameterGuidance(
                'Convolution pre-delay',
                'Sets the gap between the dry source and the first reflection of the impulse.',
                20,
                80,
                [
                    'conv-mix sets how audible the delayed tail this creates is: raise conv-predelay to separate source from a dense conv-ir.',
                ],
                ['Long pre-delay can detach the impulse tail from the source like a separate echo.'],
                noExternalModulation
            ),
            'conv-lowcut': parameterGuidance(
                'Convolution tail low cut',
                'Removes low-frequency content from the impulse tail.',
                40,
                150,
                ["conv-highcut sets the other edge of the tail's tone: set conv-lowcut and conv-highcut together."],
                ['Too little low cut lets a bright conv-ir build low-frequency mud.'],
                noExternalModulation
            ),
            'conv-highcut': parameterGuidance(
                'Convolution tail high cut',
                'Darkens the impulse tail, reducing its perceived brightness.',
                5000,
                12000,
                ["conv-lowcut sets the other edge of the tail's tone: lower conv-highcut to tame a bright conv-ir."],
                ['Too aggressive a cut can make an otherwise detailed conv-ir sound muffled.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-stereo-widener',
        effectGuidance(
            'Adjust stereo width while preserving a stable low-frequency center.',
            ['Check mono compatibility after widening.'],
            ['Width, mid/side balance, and mono-bass setting jointly determine stereo stability.'],
            ['Excess width can collapse or cancel in mono.'],
            { availability: 'not-applicable', reason: 'This width effect declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'width-amount': parameterGuidance(
                'Stereo width amount',
                'Sets how much wider or narrower the stereo image becomes.',
                0.8,
                1.5,
                [
                    'width-mono-bass keeps the low end stable while this widens the rest: raise width-amount together with a conservative width-mono-bass.',
                ],
                ['Excess width can collapse or cancel entirely when summed to mono.'],
                noExternalModulation
            ),
            'width-mid': parameterGuidance(
                'Stereo mid-channel level',
                'Sets the level of the mono-compatible center content.',
                -2,
                3,
                [
                    'width-side sets the level of the complementary side content: balance width-mid against width-side to avoid an unbalanced image.',
                ],
                ['Cutting mid level while boosting side content can make the center feel hollow.'],
                noExternalModulation
            ),
            'width-side': parameterGuidance(
                'Stereo side-channel level',
                'Sets the level of the stereo difference content.',
                0,
                4,
                [
                    'width-mid sets the level of the complementary center content: raise width-side gradually while watching width-mid balance.',
                ],
                ['Boosting side level too far can cause phase cancellation in mono.'],
                noExternalModulation
            ),
            'width-mono-bass': parameterGuidance(
                'Stereo mono-bass crossover',
                'Sets the frequency below which stereo content is summed to mono for a stable low end.',
                60,
                180,
                [
                    'width-amount sets how wide the material above this crossover becomes: raise width-mono-bass before pushing width-amount far from unity.',
                ],
                ['Too low a crossover leaves wide bass content unstable in mono playback.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-deesser',
        effectGuidance(
            'Reduce excessive sibilance while preserving intelligibility.',
            ['Use listen mode to locate the sibilant band, then turn it off before judging.'],
            ['Frequency selects the band while threshold and range set reduction.'],
            ['Over-reduction can dull consonants and make vocals lisp.'],
            { availability: 'unavailable', reason: 'This de-esser declares no automatic output compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'deess-threshold': parameterGuidance(
                'De-esser threshold',
                'Sets the sibilant-band level where reduction begins.',
                -26,
                -14,
                [
                    'deess-freq sets the band this threshold listens to and deess-range sets the depth: confirm deess-freq before setting deess-threshold.',
                ],
                ['A low threshold catches non-sibilant consonants, dulling articulation.'],
                noExternalModulation
            ),
            'deess-freq': parameterGuidance(
                'De-esser detection frequency',
                'Sets the center of the sibilant band being monitored and reduced.',
                5000,
                7500,
                [
                    'deess-listen previews this exact band and deess-threshold reacts to it: use deess-listen to confirm deess-freq before setting deess-threshold.',
                ],
                ['A mistuned frequency can miss the actual sibilance or catch cymbals and hi-hats instead.'],
                noExternalModulation
            ),
            'deess-range': parameterGuidance(
                'De-esser maximum reduction',
                'Caps how much the sibilant band can be pulled down even on the harshest hit.',
                -16,
                -6,
                [
                    'deess-threshold sets how often this cap is reached: set deess-threshold before widening deess-range.',
                ],
                ['Too deep a range can make sibilants disappear entirely, sounding lisped.'],
                noExternalModulation
            ),
            'deess-listen': parameterGuidance(
                'De-esser sidechain listen',
                'Solos the detected sibilant band so you can confirm placement by ear.',
                0,
                0,
                [
                    'deess-freq sets the band this solos: enable deess-listen while adjusting deess-freq, then disable it before judging deess-threshold.',
                ],
                [
                    'Leaving deess-listen enabled during mixdown would export the solo band instead of the processed audio.',
                ],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-lufs-meter',
        analysisGuidance(
            'Measure loudness against a delivery target without changing audio.',
            ['Treat readings as metering evidence, not a gain command.'],
            ['Target and window choose the comparison context for the measured loudness.'],
            ['Chasing short-term readings can cause unnecessary level changes.'],
            { availability: 'not-applicable', reason: 'This analyzer has no audio gain path to compensate.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'lufs-target': parameterGuidance(
                'Loudness delivery target',
                'Sets the reference LUFS the meter compares the measured level against.',
                -18,
                -11,
                [
                    'lufs-window sets which time constant the measurement compares against this target: choose lufs-window before reading against lufs-target.',
                ],
                ['Chasing a target meant for one delivery platform can misrepresent loudness for another.'],
                noExternalModulation
            ),
            'lufs-window': parameterGuidance(
                'Loudness measurement window',
                'Sets the time constant the meter integrates over before reporting a reading.',
                1,
                2,
                [
                    'lufs-target sets what the reading from this window is compared against: read lufs-window against lufs-target before finalizing delivery.',
                ],
                [
                    'Reading a momentary window as if it were the integrated loudness misrepresents overall program level.',
                ],
                noExternalModulation
            ),
        }
    ),
];
