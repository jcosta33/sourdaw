import { descriptorGuidance, parameterGuidance } from './DescriptorGuidance';
import { NO_SOURCE_SPECIFIC_MODULATION, analysisGuidance, effectGuidance } from './GuidanceProfiles';

/**
 * Per-parameter guidance declarations for the Faust effect descriptors.
 *
 * Split out of FaustEffectDescriptors.ts to keep both files under the
 * repository's max-lines ceiling; this file owns only the guidance data,
 * never descriptor parameter shape. Every device below authors
 * `parameterOverrides` for 100% of its parameters, so none needs a
 * `parameterFallback` — that generic-text fallback stays reserved for
 * instrument descriptors.
 */

const faustEffectGuidance = effectGuidance(
    'Use the declared Faust effect controls conservatively and level-match against bypass.',
    ['Set wet level or output staging before increasing nonlinear or feedback behavior.'],
    ['Time, tone, dynamics, and wet-path controls interact through the selected Faust algorithm.'],
    ['Extreme settings can build level, mask source detail, or create harsh artifacts.'],
    { availability: 'unavailable', reason: 'These Faust descriptors declare no automatic output compensation.' }
);

export const FAUST_EFFECT_DESCRIPTORS_GUIDANCE = [
    descriptorGuidance('faust-zita-rev1-reverb', faustEffectGuidance, undefined, {
        decay_time: parameterGuidance(
            'Zita-Rev1 low-frequency decay time',
            "Sets how long low-frequency (DC) content in the tail takes to fade to silence, relative to the engine's fixed 2 s mid-band decay.",
            1,
            4,
            [
                'damping sets the corner frequency the wet path brightens above: lower damping to tame a long decay_time.',
            ],
            [
                'A long decay_time relative to the fixed 2 s mid-band decay can leave low-frequency rumble ringing under a comparatively short mid-band tail.',
            ],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        damping: parameterGuidance(
            'Zita-Rev1 high-frequency damping',
            'Sets the frequency above which the tail fades faster than the rest.',
            2000,
            5000,
            [
                'decay_time sets the overall tail length that damping shapes the brightness of: set decay_time before tuning damping.',
            ],
            ['High damping frequency on a long decay_time can leave a harsh, bright tail.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        dry_wet: parameterGuidance(
            'Zita-Rev1 wet mix',
            'Sets the proportion of reverberated signal blended with the dry source.',
            0.15,
            0.4,
            [
                'decay_time and damping set the character this proportion carries: balance dry_wet after decay_time and damping are set.',
            ],
            ['High wet mix can push a source behind the arrangement.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-1176-compressor', faustEffectGuidance, undefined, {
        ratio: parameterGuidance(
            '1176-style compression ratio',
            'Sets how strongly signal above threshold is reduced, up through the classic "all-buttons" extremes.',
            4,
            12,
            ['threshold sets where this ratio begins applying: raise ratio only after threshold is set.'],
            ['Extreme ratios approaching the top of the range can pump aggressively on percussive sources.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        threshold: parameterGuidance(
            '1176-style compression threshold',
            'Sets the input level where gain reduction begins.',
            -30,
            -14,
            ['ratio sets how hard reduction bites once past this point: set ratio after threshold is set.'],
            ['Low thresholds combined with a high ratio can crush transients entirely.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        attack: parameterGuidance(
            '1176-style attack time',
            'Sets how quickly gain reduction catches transients, down to sub-millisecond speeds.',
            0.0002,
            0.005,
            ['release sets how the envelope recovers after this catches a peak: balance attack against release.'],
            ['Extremely fast attack can distort low-frequency transients by catching the waveform itself.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        release: parameterGuidance(
            '1176-style release time',
            'Sets how quickly gain reduction recovers after peaks.',
            0.05,
            0.2,
            [
                'attack sets how quickly reduction engages before this recovers it: set attack against release and source tempo.',
            ],
            ['Very fast release can distort low-frequency material by modulating within a cycle.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-multiband-compressor', faustEffectGuidance, undefined, {
        low_threshold: parameterGuidance(
            'Low-band compression threshold',
            'Sets the level where the low band begins reducing gain.',
            -30,
            -12,
            [
                'crossover_low sets the top edge of the band this threshold controls: set crossover_low before tuning low_threshold.',
            ],
            ['A low low_threshold can over-compress bass and kick, removing low-end punch.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        mid_threshold: parameterGuidance(
            'Mid-band compression threshold',
            'Sets the level where the mid band begins reducing gain.',
            -24,
            -8,
            [
                'crossover_low and crossover_high set the band this threshold controls: set both crossovers before tuning mid_threshold.',
            ],
            ['A low mid_threshold can dull vocal or instrument presence in the midrange.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        high_threshold: parameterGuidance(
            'High-band compression threshold',
            'Sets the level where the high band begins reducing gain.',
            -20,
            -6,
            [
                'crossover_high sets the bottom edge of the band this threshold controls: set crossover_high before tuning high_threshold.',
            ],
            ['A low high_threshold can dull air and sibilance in the top end.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        crossover_low: parameterGuidance(
            'Low/mid crossover frequency',
            'Sets the boundary between the low and mid compression bands.',
            100,
            250,
            [
                'crossover_high sets the other band boundary: keep crossover_low well below crossover_high to leave a usable mid band.',
            ],
            ['Placing this too close to crossover_high leaves almost no mid band to compress independently.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        crossover_high: parameterGuidance(
            'Mid/high crossover frequency',
            'Sets the boundary between the mid and high compression bands.',
            2000,
            6000,
            [
                'crossover_low sets the other band boundary: keep crossover_high well above crossover_low to leave a usable mid band.',
            ],
            ['Placing this too close to crossover_low leaves almost no mid band to compress independently.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-pro-parametric-eq', faustEffectGuidance, undefined, {
        lf_gain: parameterGuidance(
            'Low-band gain',
            'Boosts or cuts the low-frequency foundation of the source.',
            -4,
            4,
            ['lf_freq sets where this acts: set lf_freq before pushing lf_gain far from zero.'],
            ['Large boosts build mud against a kick or bass on the same band.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        lf_freq: parameterGuidance(
            'Low-band center frequency',
            'Selects the bass region that the low band shapes.',
            60,
            180,
            ['lf_gain sets how much changes here: nail lf_freq before raising lf_gain.'],
            ['Very low centers can mask kick and bass fundamentals.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        mf_gain: parameterGuidance(
            'Mid-band gain',
            'Boosts or cuts the selected midrange emphasis.',
            -5,
            5,
            [
                'mf_freq selects the material this changes and mf_q sets its focus: set mf_freq and mf_q before pushing this far.',
            ],
            ['Boosts can add harshness and use output headroom.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        mf_freq: parameterGuidance(
            'Mid-band center frequency',
            'Selects the midrange region that the mid band shapes.',
            400,
            4000,
            [
                'mf_gain sets the amount applied here and mf_q sets its width: choose this center before dialing in mf_gain.',
            ],
            ['Placing this near vocal presence with a large cut can dull intelligibility.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        mf_q: parameterGuidance(
            'Mid-band Q',
            'Sets how narrowly the mid-band gain is focused.',
            0.7,
            3,
            [
                'mf_freq places the center this narrows around, and mf_gain sets the amount: widen mf_q before mf_gain reaches extremes.',
            ],
            ['A narrow mf_q with a strong cut can sound phasey or nasal.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        hf_gain: parameterGuidance(
            'High-band gain',
            'Boosts or cuts top-end air and sheen.',
            -4,
            6,
            ['hf_freq sets where this acts: set hf_freq before pushing hf_gain.'],
            ['Boosts above a few dB can add sibilance or amplify noise floor.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        hf_freq: parameterGuidance(
            'High-band center frequency',
            'Selects the treble region that the high band shapes.',
            5000,
            12000,
            ['hf_gain sets the amount changed here: choose this center before raising hf_gain.'],
            ['Too low a corner can dull the midrange presence instead of adding air.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-tape-delay', faustEffectGuidance, undefined, {
        delay: parameterGuidance(
            'Tape delay time',
            'Sets the spacing between repeated echoes.',
            0.08,
            0.5,
            ['feedback sets how many repeats follow the spacing this sets: choose delay before raising feedback.'],
            ['Long unsynced delay times can clutter rhythmic material against the tempo.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        feedback: parameterGuidance(
            'Tape delay feedback',
            'Sets how much delayed signal returns for additional repeats.',
            0.15,
            0.55,
            ['delay sets the spacing each repeat this feeds back inherits: raise feedback only after delay is set.'],
            ['High feedback values can run away toward self-oscillation or mask the dry signal.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        dry_wet: parameterGuidance(
            'Tape delay wet mix',
            'Sets the proportion of delayed signal blended with the dry source.',
            0.15,
            0.4,
            [
                'feedback sets how many repeats this proportion of signal carries: balance dry_wet after feedback is set.',
            ],
            ['High wet mix with high feedback can overwhelm the dry signal.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        tone: parameterGuidance(
            'Tape delay repeat tone',
            'Darkens each repeat, emulating tape high-frequency loss over successive passes.',
            2000,
            5000,
            [
                'feedback sets how many times this darkening compounds: lower tone for a more pronounced tape-like darkening across feedback repeats.',
            ],
            ['Too dark a tone with high feedback can make repeats disappear entirely.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-brick-wall-limiter', faustEffectGuidance, undefined, {
        ceiling: parameterGuidance(
            'Brick-wall output ceiling',
            'Sets the hard maximum output level the limiter will not exceed.',
            -2,
            -0.1,
            [
                'lookahead sets how much warning this cap gets before a transient arrives: set lookahead before driving ceiling down.',
            ],
            ['A ceiling too close to 0 dB can clip on inter-sample peaks after conversion.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        release: parameterGuidance(
            'Brick-wall release time',
            'Sets how quickly gain recovers after the limiter catches a peak.',
            20,
            150,
            [
                'lookahead sets how early reduction engages before this recovers it: match release to program tempo once lookahead is set.',
            ],
            ['Very fast release can distort low-frequency peaks by recovering within a cycle.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        lookahead: parameterGuidance(
            'Brick-wall lookahead time',
            'Sets how far ahead the limiter previews the signal to catch a peak before it clips.',
            2,
            6,
            ['ceiling sets the cap this lookahead protects: raise lookahead if ceiling still lets transients through.'],
            ['Too little lookahead lets fast transients slip through before the ceiling can react.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-spring-reverb', faustEffectGuidance, undefined, {
        decay: parameterGuidance(
            'Spring reverb decay time',
            'Sets how long the springs ring before the tail fades to silence.',
            0.5,
            2.5,
            [
                'brightness sets the damping that darkens the tail this sets the length of: raise brightness to tame a long, ringing decay.',
            ],
            ['Long decay times can build a boingy, overly resonant tail.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        brightness: parameterGuidance(
            'Spring reverb brightness (damping)',
            'Functions as a damping control on the spring tail: higher values darken and shorten perceived brightness, lower values leave the tail brighter and more resonant.',
            0.3,
            0.6,
            ['decay sets the overall tail length that brightness darkens: set decay before tuning brightness.'],
            ['High brightness values can darken the tail into a dull, muffled ring.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        mix: parameterGuidance(
            'Spring reverb wet mix',
            'Sets the proportion of the spring tail blended with the dry source.',
            0.15,
            0.4,
            [
                'decay and brightness set the character this proportion carries: balance mix after decay and brightness are set.',
            ],
            ['High wet mix can push a source behind the arrangement.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-noise-gate', faustEffectGuidance, undefined, {
        threshold: parameterGuidance(
            'Noise gate threshold',
            'Sets the input level below which the gate closes.',
            -55,
            -30,
            [
                'hold sets how long the gate stays open after signal drops below this level: set hold after threshold is confirmed.',
            ],
            ['A threshold set too high can chop off quiet natural decay or breath sounds.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        attack: parameterGuidance(
            'Noise gate attack time',
            'Sets how quickly the gate opens once signal crosses threshold.',
            0.0002,
            0.01,
            [
                'release sets how the gate closes after this opens it: balance attack against release for a natural envelope.',
            ],
            ['Very slow attack can clip off the start of a transient before the gate fully opens.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        hold: parameterGuidance(
            'Noise gate hold time',
            'Sets how long the gate stays fully open after signal drops below threshold.',
            0.02,
            0.1,
            ['threshold sets when this hold period starts: raise hold if the gate chatters near threshold.'],
            ['Too short a hold can cause audible chatter on a decaying signal near threshold.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        release: parameterGuidance(
            'Noise gate release time',
            'Sets how quickly the gate closes after the hold period ends.',
            0.05,
            0.25,
            [
                'attack sets how quickly the gate opens before this closes it: set attack against release and source decay.',
            ],
            ['Very fast release can create an audible clamp on natural instrument decay.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-gain-utility', faustEffectGuidance, undefined, {
        gain: parameterGuidance(
            'Utility gain trim',
            'Raises or lowers the signal level entering the next device.',
            -6,
            6,
            ['width sets the stereo image this level is applied to: set gain before adjusting width.'],
            ['Positive gain can clip a later device even when this stage remains clean.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        invert_phase: parameterGuidance(
            'Phase invert',
            'Flips the polarity of the signal to fix cancellation with another source.',
            0,
            0,
            [
                'gain sets the level this polarity flip is applied to: confirm invert_phase before trusting a gain-staged blend against another source.',
            ],
            ['Enabling this without a phase problem to fix can itself introduce cancellation against another track.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        width: parameterGuidance(
            'Utility stereo width',
            'Sets how wide or narrow the stereo image is scaled.',
            0.7,
            1.3,
            ['gain sets the level of the image this width scales: set gain before adjusting width.'],
            ['Extreme width can collapse or cancel entirely when summed to mono.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance(
        'faust-lufs-meter',
        analysisGuidance(
            'Measure loudness without changing audio.',
            ['Use meter readings as evidence rather than a gain command.'],
            ['The selected window and target determine how the reading is interpreted.'],
            ['Chasing short-term readings can cause unnecessary processing.'],
            { availability: 'not-applicable', reason: 'This analyzer has no audio level to compensate.' }
        ),
        // No fallback and no overrides: this analyzer declares zero parameters.
        undefined,
        {}
    ),
    descriptorGuidance('faust-stereo-widener', faustEffectGuidance, undefined, {
        width: parameterGuidance(
            'Stereo width percentage',
            'Sets how wide or narrow the stereo image is scaled, in percent of the original.',
            80,
            140,
            [
                'mono_bass keeps the low end stable while this widens the rest: raise width together with a conservative mono_bass.',
            ],
            ['Excess width can collapse or cancel entirely when summed to mono.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        mono_bass: parameterGuidance(
            'Mono-bass crossover frequency',
            'Sets the frequency below which stereo content is summed to mono for a stable low end.',
            60,
            180,
            [
                'width sets how wide the material above this crossover becomes: raise mono_bass before pushing width far from 100%.',
            ],
            ['Too low a crossover leaves wide bass content unstable in mono playback.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
    descriptorGuidance('faust-de-esser', faustEffectGuidance, undefined, {
        threshold: parameterGuidance(
            'De-esser threshold',
            'Sets the sibilant-band level where reduction begins.',
            -24,
            -8,
            [
                'frequency sets the band this threshold listens to and reduction sets the depth: confirm frequency before setting threshold.',
            ],
            ['A low threshold catches non-sibilant consonants, dulling articulation.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        frequency: parameterGuidance(
            'De-esser detection frequency',
            'Sets the center of the sibilant band being monitored and reduced.',
            5000,
            7500,
            [
                'listen previews this exact band and bandwidth sets its width: use listen to confirm frequency before setting bandwidth.',
            ],
            ['A mistuned frequency can miss the actual sibilance or catch cymbals and hi-hats instead.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        bandwidth: parameterGuidance(
            'De-esser detection bandwidth',
            'Sets how wide a band around the detection frequency is monitored for sibilance.',
            1,
            3,
            [
                'frequency sets the center this bandwidth surrounds: narrow bandwidth once frequency is confirmed with listen.',
            ],
            ['Too wide a bandwidth catches adjacent non-sibilant material and dulls it too.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        ratio: parameterGuidance(
            'De-esser reduction ratio',
            'Sets how strongly the detected sibilant band is reduced once past threshold.',
            3,
            10,
            [
                'threshold sets where this ratio starts applying and reduction caps its result: set threshold before raising ratio.',
            ],
            ['High ratios can make sibilants disappear abruptly rather than smoothly taming them.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        reduction: parameterGuidance(
            'De-esser maximum reduction',
            'Caps how much the sibilant band can be pulled down even on the harshest hit.',
            3,
            9,
            ['ratio sets how quickly this cap is reached: set ratio before widening reduction.'],
            ['Too deep a reduction can make sibilants disappear entirely, sounding lisped.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
        listen: parameterGuidance(
            'De-esser sidechain listen',
            'Solos the detected sibilant band so you can confirm placement by ear.',
            0,
            0,
            [
                'frequency sets the band this solos: enable listen while adjusting frequency, then disable it before judging threshold.',
            ],
            ['Leaving listen enabled during mixdown would export the solo band instead of the processed audio.'],
            NO_SOURCE_SPECIFIC_MODULATION
        ),
    }),
];
