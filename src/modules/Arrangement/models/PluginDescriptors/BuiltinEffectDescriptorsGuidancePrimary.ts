import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, effectGuidance } from './GuidanceProfiles';

/**
 * Per-parameter guidance declarations for the first half of the built-in
 * effect descriptors (EQ through Phaser).
 *
 * Split out of BuiltinEffectDescriptorsGuidance.ts, which the whole built-in
 * guidance table would otherwise exceed the repository's max-lines ceiling
 * to hold in one file; BuiltinEffectDescriptorsGuidance.ts concatenates this
 * with its counterpart and re-exports the combined table. This file owns
 * only guidance data, never descriptor parameter shape.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_PRIMARY = [
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
        'builtin-reverb',
        effectGuidance(
            'Place a source in an artificial acoustic space with controlled wet level.',
            ['Use wet mix conservatively and compare in the full arrangement.'],
            ['Size and decay determine tail density; damping and low cut determine tonal balance.'],
            ['Long or bright tails can obscure rhythm and accumulate low-frequency energy.'],
            {
                availability: 'not-applicable',
                reason: 'This reverb declares no automatic wet-path output compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'rev-size': parameterGuidance(
                'Reverb room size',
                'Sets the perceived size of the simulated space.',
                0.3,
                0.7,
                [
                    'rev-decay sets how long this space rings and rev-damping sets its brightness: set rev-size before tuning rev-decay.',
                ],
                ['A large room size with long rev-decay can build low-frequency density.'],
                noExternalModulation
            ),
            'rev-decay': parameterGuidance(
                'Reverb decay time',
                'Sets how long the reverb tail takes to fade to silence.',
                0.8,
                4,
                [
                    'rev-size sets the space this tail rings in and rev-damping sets its tonal fade: raise rev-decay only after rev-size is set.',
                ],
                ['Long decay times can mask timing and rhythmic detail in a dense mix.'],
                noExternalModulation
            ),
            'rev-damping': parameterGuidance(
                'Reverb high-frequency damping',
                'Sets how quickly high frequencies fade within the tail.',
                0.4,
                0.8,
                [
                    'rev-decay sets the overall tail length that rev-damping shapes the brightness of: raise rev-damping to tame a bright rev-decay.',
                ],
                ['Low damping on a long decay can leave a harsh, metallic tail.'],
                noExternalModulation
            ),
            'rev-predelay': parameterGuidance(
                'Reverb pre-delay',
                'Sets the gap between the dry source and the first reflection.',
                20,
                80,
                [
                    "rev-mix sets how audible the tail this delays is: raise rev-predelay to separate the source from rev-mix's wet tail.",
                ],
                ['Long pre-delay can detach the tail from the source and sound like a separate echo.'],
                noExternalModulation
            ),
            'rev-lowcut': parameterGuidance(
                'Reverb tail low cut',
                'Removes low-frequency content from the reverb tail before it sums with the source.',
                100,
                400,
                [
                    'rev-mix sets how much of this filtered tail is audible: raise rev-lowcut before raising rev-mix on bass-heavy sources.',
                ],
                ['Too little low cut lets the tail build mud under a bass-heavy source.'],
                noExternalModulation
            ),
            'rev-mix': parameterGuidance(
                'Reverb wet mix',
                'Sets the proportion of reverberated signal in the output.',
                0.1,
                0.35,
                [
                    'rev-size and rev-decay set the character this proportion of signal carries: balance rev-mix after rev-size and rev-decay are set.',
                ],
                ['High wet mix can push a source behind the arrangement.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-delay',
        effectGuidance(
            'Create rhythmic repeats while keeping feedback and wet level under control.',
            ['Increase feedback gradually and leave headroom for repeat accumulation.'],
            ['Delay time establishes rhythm; feedback establishes repeat count; filters shape repeat tone.'],
            ['High feedback can build unexpectedly and mask the dry signal.'],
            { availability: 'not-applicable', reason: 'This delay declares no automatic repeat-level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'delay-time': parameterGuidance(
                'Delay time',
                'Sets the spacing between repeated echoes.',
                80,
                750,
                [
                    'delay-feedback sets how many repeats follow the spacing this sets: choose delay-time before raising delay-feedback for rhythmic density.',
                ],
                ['Long unsynced times can clutter rhythmic material against the tempo.'],
                noExternalModulation
            ),
            'delay-feedback': parameterGuidance(
                'Delay feedback',
                'Sets how much delayed signal returns for additional repeats.',
                0.15,
                0.65,
                [
                    'delay-time sets the spacing each repeat this feeds back inherits: raise delay-feedback only after delay-time is set.',
                ],
                ['High feedback values can build a long, ringing repeat trail or mask the dry signal.'],
                noExternalModulation
            ),
            'delay-lowcut': parameterGuidance(
                'Delay repeat low cut',
                'Removes low-frequency content from each repeat so they thin out over time.',
                100,
                500,
                [
                    "delay-highcut sets the other edge of the repeat's tone: set delay-lowcut and delay-highcut together to shape the echo band.",
                ],
                ['Too little low cut lets repeats accumulate low-frequency buildup with delay-feedback.'],
                noExternalModulation
            ),
            'delay-highcut': parameterGuidance(
                'Delay repeat high cut',
                'Darkens each repeat so later echoes read as further away.',
                4000,
                10000,
                [
                    "delay-lowcut sets the other edge of the repeat's tone: lower delay-highcut to push repeats further behind the dry signal.",
                ],
                ['Too aggressive a cut can make repeats disappear entirely at high delay-feedback.'],
                noExternalModulation
            ),
            'delay-mix': parameterGuidance(
                'Delay wet mix',
                'Sets the proportion of delayed signal blended with the dry source.',
                0.15,
                0.4,
                [
                    'delay-feedback sets how many repeats this proportion of signal carries: balance delay-mix after delay-feedback is set.',
                ],
                ['High wet mix with high delay-feedback can overwhelm the dry signal.'],
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
        'builtin-chorus',
        effectGuidance(
            'Add moving detune and width to a source.',
            ['Keep wet depth moderate to preserve pitch focus.'],
            ['Rate and depth set movement; feedback and mix set density.'],
            ['High depth can blur pitch and mono compatibility.'],
            {
                availability: 'not-applicable',
                reason: 'This modulation effect declares no automatic level compensation.',
            }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'chorus-rate': parameterGuidance(
                'Chorus LFO rate',
                'Sets how fast the detuned voice sweeps.',
                0.3,
                2,
                [
                    'chorus-depth sets how far this sweep travels: raise chorus-rate only after chorus-depth is set to keep the motion musical.',
                ],
                ['Fast rates with deep chorus-depth can sound seasick rather than lush.'],
                noExternalModulation
            ),
            'chorus-depth': parameterGuidance(
                'Chorus sweep depth',
                'Sets how far the detuned voice pitch-shifts as it sweeps.',
                2,
                8,
                [
                    'chorus-rate sets how fast this sweep travels and chorus-feedback thickens it: balance chorus-depth against chorus-rate first.',
                ],
                ['Deep sweeps can blur pitch focus and mono compatibility.'],
                noExternalModulation
            ),
            'chorus-feedback': parameterGuidance(
                'Chorus feedback amount',
                'Sets how much detuned signal recirculates for a denser, more resonant chorus.',
                0.05,
                0.3,
                [
                    'chorus-depth sets the sweep this recirculates and chorus-mix sets its audibility: raise chorus-feedback gradually after chorus-depth is set.',
                ],
                ['High feedback can add metallic comb-filter coloration.'],
                noExternalModulation
            ),
            'chorus-mix': parameterGuidance(
                'Chorus wet mix',
                'Sets the proportion of chorused signal blended with the dry source.',
                0.3,
                0.6,
                [
                    'chorus-depth and chorus-feedback set the character this proportion carries: set those before chorus-mix.',
                ],
                ['High wet mix can collapse pitch focus on a solo instrument.'],
                noExternalModulation
            ),
        }
    ),
    descriptorGuidance(
        'builtin-phaser',
        effectGuidance(
            'Sweep phase-cancelled bands for motion and color.',
            ['Use feedback sparingly on bright sources.'],
            ['Rate and depth control the sweep; feedback increases resonance.'],
            ['High feedback can create sharp resonances.'],
            { availability: 'not-applicable', reason: 'This phase effect declares no automatic level compensation.' }
        ),
        // No fallback: every parameter below is authored by hand.
        undefined,
        {
            'phaser-rate': parameterGuidance(
                'Phaser sweep rate',
                'Sets how fast the notches sweep across the spectrum.',
                0.1,
                1.5,
                [
                    'phaser-depth sets how far the notches this rate sweeps travel: set phaser-depth before raising phaser-rate.',
                ],
                ['Fast rates with high phaser-feedback can sound warbly and seasick.'],
                noExternalModulation
            ),
            'phaser-depth': parameterGuidance(
                'Phaser sweep depth',
                'Sets how far the notch frequencies travel during the sweep.',
                0.3,
                0.8,
                [
                    'phaser-rate sets how fast this sweep travels and phaser-stages sets the notch count: balance phaser-depth against phaser-stages.',
                ],
                ['Full depth with many phaser-stages can sound like a dramatic sweep rather than subtle motion.'],
                noExternalModulation
            ),
            'phaser-feedback': parameterGuidance(
                'Phaser resonance amount',
                'Sets how sharply the notches resonate as they sweep.',
                0.1,
                0.4,
                [
                    'phaser-stages sets how many notches this sharpens: raise phaser-feedback cautiously with a high phaser-stages count.',
                ],
                ['High feedback can create sharp, piercing resonant peaks.'],
                noExternalModulation
            ),
            'phaser-stages': parameterGuidance(
                'Phaser notch stage count',
                'Sets how many all-pass stages create notches, thickening the effect.',
                4,
                8,
                [
                    'phaser-feedback sets how sharp each notch this adds resonates: raise phaser-stages before increasing phaser-feedback further.',
                ],
                ['High stage counts with fast phaser-rate can create a chaotic-sounding sweep.'],
                noExternalModulation
            ),
        }
    ),
];
