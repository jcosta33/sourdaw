import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, effectGuidance } from './GuidanceProfiles';

/**
 * Per-parameter guidance declarations for the built-in time-and-space-family
 * effect descriptors: reverb, delay, and the modulation effects that move a
 * source in time or across the stereo field.
 *
 * Split out of BuiltinEffectDescriptorsGuidance.ts, which the whole built-in
 * guidance table would otherwise exceed the repository's max-lines ceiling
 * to hold in one file; BuiltinEffectDescriptorsGuidance.ts spreads this
 * table together with its Dynamics and Tone counterparts and re-exports the
 * combined table. This file owns only guidance data, never descriptor
 * parameter shape. A new time-and-space-family device's guidance belongs
 * here.
 */

const noExternalModulation = NO_SOURCE_SPECIFIC_MODULATION;

export const BUILTIN_EFFECT_DESCRIPTORS_GUIDANCE_TIME_AND_SPACE = [
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
                'Chooses the captured space that colors the reverb character, spanning the plate through studio-b rooms used most often in mixing.',
                3,
                7,
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
];
