import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, analysisGuidance, effectGuidance } from './GuidanceProfiles';

/**
 * Per-parameter guidance declarations for the built-in dynamics-family
 * effect descriptors: compression, limiting, de-essing, gain staging, and
 * loudness metering.
 *
 * Split out of BuiltinEffectDescriptorsGuidance.ts, which the whole built-in
 * guidance table would otherwise exceed the repository's max-lines ceiling
 * to hold in one file; BuiltinEffectDescriptorsGuidance.ts spreads this
 * table together with its Tone and TimeAndSpace counterparts and re-exports
 * the combined table. This file owns only guidance data, never descriptor
 * parameter shape. A new dynamics-family device's guidance belongs here.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_DYNAMICS = [
    descriptorGuidance(
        'builtin-compressor',
        effectGuidance(
            'Control dynamic range while preserving the source envelope.',
            ['Level-match makeup gain against bypass and watch for pumping.'],
            ['Threshold and ratio set reduction; attack and release shape the envelope response.'],
            ['Fast timing or excessive makeup can flatten transients and clip later stages.'],
            {
                availability: 'provided',
                parameterId: 'comp-makeup',
                detail: 'Makeup gain restores deliberate level after compression.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'comp-threshold': parameterGuidance(
                'Compression threshold',
                'Sets the input level where gain reduction begins.',
                -30,
                -12,
                [
                    'comp-ratio sets how hard reduction bites once past this point, and comp-knee sets how gradually it starts: set comp-ratio and comp-knee together with this.',
                ],
                ['Low thresholds can over-compress program material and remove dynamic contrast.'],
                noExternalModulation
            ),
            'comp-ratio': parameterGuidance(
                'Compression ratio',
                'Sets how strongly signal above threshold is reduced.',
                2,
                6,
                [
                    'comp-threshold sets where reduction starts and comp-knee sets how gradually this ratio engages: raise comp-ratio only after comp-threshold is set.',
                ],
                ['High ratios can make transients and ambience sound constrained or squashed.'],
                noExternalModulation
            ),
            'comp-attack': parameterGuidance(
                'Compression attack time',
                'Sets how quickly gain reduction catches transients.',
                5,
                30,
                [
                    'comp-release sets how the envelope recovers after this catches a peak: balance comp-attack against comp-release to avoid audible pumping.',
                ],
                ['Very fast attacks can remove punch by catching the transient itself.'],
                noExternalModulation
            ),
            'comp-release': parameterGuidance(
                'Compression release time',
                'Sets how quickly gain reduction recovers after peaks.',
                50,
                250,
                [
                    'comp-attack sets how quickly reduction engages before this recovers it: set comp-attack against comp-release and the source tempo.',
                ],
                ['Very short releases can distort low-frequency material by modulating within a cycle.'],
                noExternalModulation
            ),
            'comp-knee': parameterGuidance(
                'Compression knee width',
                'Sets how gradually gain reduction ramps in around the threshold.',
                2,
                10,
                [
                    'comp-threshold sets the center this knee widens around: raise this to soften transitions near comp-threshold on program material.',
                ],
                ['A wide knee can start reducing gain well below comp-threshold, softening perceived punch.'],
                noExternalModulation
            ),
            'comp-makeup': parameterGuidance(
                'Makeup gain',
                'Restores output level after intentional gain reduction.',
                0,
                6,
                [
                    'comp-threshold and comp-ratio set how much level this needs to restore: level-match comp-makeup against bypass after those are set.',
                ],
                ['Excess makeup can clip later devices in the chain.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-sidechain-compressor',
        effectGuidance(
            'Apply sidechain-aware compression when a supported routing source is connected.',
            ['Confirm sidechain routing before relying on ducking and level-match makeup gain.'],
            ['Threshold and ratio react to the sidechain path while attack and release set the ducking envelope.'],
            ['Incorrect routing or excessive makeup can create unstable level changes.'],
            {
                availability: 'provided',
                parameterId: 'sc-comp-makeup',
                detail: 'Makeup gain restores deliberate level after sidechain reduction.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'sc-comp-threshold': parameterGuidance(
                'Sidechain ducking threshold',
                'Sets the sidechain input level where ducking begins.',
                -30,
                -10,
                [
                    'sc-comp-ratio sets how hard ducking bites once the sidechain source crosses this: set sc-comp-ratio after sc-comp-threshold.',
                ],
                ['A low threshold ducks on quiet sidechain hits, chattering on busy material.'],
                noExternalModulation
            ),
            'sc-comp-ratio': parameterGuidance(
                'Sidechain ducking ratio',
                'Sets how deeply the source ducks once the sidechain crosses threshold.',
                3,
                10,
                [
                    'sc-comp-threshold sets where this ratio starts applying: raise sc-comp-ratio only after sc-comp-threshold is confirmed with routing.',
                ],
                ['High ratios can remove musical attacks from the ducked source entirely.'],
                noExternalModulation
            ),
            'sc-comp-attack': parameterGuidance(
                'Sidechain ducking attack time',
                'Sets how quickly the duck engages after the sidechain source hits.',
                3,
                20,
                [
                    'sc-comp-release sets how the duck recovers after sc-comp-attack engages it: balance the two against the sidechain source tempo.',
                ],
                ["Very fast attack can remove the punch of the ducked source's own transient."],
                noExternalModulation
            ),
            'sc-comp-release': parameterGuidance(
                'Sidechain ducking release time',
                'Sets how quickly the ducked source recovers between sidechain hits.',
                60,
                300,
                [
                    "sc-comp-attack sets how quickly the duck engages before sc-comp-release recovers it: match sc-comp-release to the sidechain source's rhythm.",
                ],
                ['Too short a release can pump audibly in time with a busy sidechain source.'],
                noExternalModulation
            ),
            'sc-comp-makeup': parameterGuidance(
                'Sidechain ducking makeup gain',
                'Restores level lost to ducking after the sidechain event passes.',
                0,
                5,
                [
                    'sc-comp-threshold and sc-comp-ratio set how much ducking this restores: level-match sc-comp-makeup against bypass.',
                ],
                ['Excess makeup can clip once the sidechain event passes and ducking releases.'],
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
        'builtin-gain',
        effectGuidance(
            'Trim a signal deliberately before the next processing stage.',
            ['Watch downstream headroom when adding gain.'],
            ['Use with later dynamics processors to establish staging.'],
            ['Positive gain can clip a later device even when this control itself is clean.'],
            {
                availability: 'not-applicable',
                reason: 'A gain utility is the level control itself, not automatic compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'gain-level': parameterGuidance(
                'Output trim level',
                'Raises or lowers the signal level entering the next device.',
                -6,
                6,
                ['Set this before any downstream dynamics processor so its own threshold sees the intended level.'],
                ['Positive trim can clip a later device even when this stage remains clean.'],
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
