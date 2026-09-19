import { type MixRecipe } from '../../models/MixRecipe';

/** Authored mixing recipes for electric and acoustic guitar parts. */
export const guitarMixRecipes: readonly MixRecipe[] = [
    {
        id: 'guitar-warm',
        descriptor: 'warm',
        roles: ['guitar'],
        title: 'Body lifted, top shelf eased',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 120, maximum: 180 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 3.5 },
                    { paramId: 'eq-high-freq', minimum: 6000, maximum: 10000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: ['The part has content below 200 Hz; a heavily high-passed rhythm guitar has nothing to lift.'],
        contraindications: [
            'Skip when the guitar already competes with the bass below 200 Hz.',
            'Skip when the part carries the top of an otherwise dark arrangement.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'Guitar body sits between 120 Hz and 180 Hz, above the bass fundamental and below the boxy region, so a shelf there adds weight without either collision. Easing the top at the same time makes the tilt read as warmth rather than as added low end.',
    },
    {
        id: 'guitar-bright',
        descriptor: 'bright',
        roles: ['guitar'],
        title: 'Pick attack and top shelf raised together',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 2500, maximum: 4000 },
                    { paramId: 'eq-mid-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-mid-q', minimum: 0.8, maximum: 1.5 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: 2, maximum: 3.5 },
                ],
            },
        ],
        prerequisites: ['The guitar is not already fighting the vocal between 2 kHz and 4 kHz.'],
        contraindications: [
            'Skip when a lead vocal needs that same presence region to stay intelligible.',
            'Skip on a distorted rhythm part where the region is already dense with harmonics.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'increase' },
            { metric: 'frequencyBandEnergy', band: 'high-mid', direction: 'increase' },
        ],
        source: 'Pick definition lives near 3 kHz and string shimmer above 8 kHz, and a guitar reads bright only when both rise. That 3 kHz region is also where vocals sit, which is why the contraindication is specific rather than general caution.',
    },
    {
        id: 'guitar-tight',
        descriptor: 'tight',
        roles: ['guitar'],
        title: 'Low shoulder trimmed under firm compression',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 100, maximum: 150 },
                    { paramId: 'eq-low-gain', minimum: -5, maximum: -2 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -22, maximum: -14 },
                    { paramId: 'comp-ratio', minimum: 3, maximum: 5 },
                    { paramId: 'comp-attack', minimum: 5, maximum: 15 },
                    { paramId: 'comp-release', minimum: 60, maximum: 120 },
                ],
            },
        ],
        prerequisites: [
            'The part is a rhythm or accompaniment guitar rather than a sustaining lead that needs its low body.',
        ],
        contraindications: [
            'Skip on a solo acoustic arrangement where the guitar is the only source below 200 Hz.',
            'Skip when the performance depends on dynamic contrast between strummed and picked passages.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'Trimming below 150 Hz before compression stops the low shoulder driving gain reduction, so the remaining reduction tracks the strum rather than the body. The two moves together shorten the perceived decay of each chord, which is what tightness means on a guitar.',
    },
    {
        id: 'guitar-punchy',
        descriptor: 'punchy',
        roles: ['guitar'],
        title: 'Strum attack preserved over a compressed sustain',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -20, maximum: -12 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 4 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 80, maximum: 150 },
                    { paramId: 'comp-makeup', minimum: 2, maximum: 5 },
                ],
            },
        ],
        prerequisites: ['The source retains its pick transients rather than arriving already limited.'],
        contraindications: [
            'Skip on a heavily distorted part, whose transients the distortion has already removed.',
            'Skip when a fast limiter sits earlier in the chain.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'increase' },
            { metric: 'transientDensity', direction: 'hold' },
        ],
        source: 'An attack longer than the pick transient lets that transient through and clamps the ringing behind it, and makeup gain then raises the strike relative to the sustain. Peak-to-average widens as a result even though the part gets louder overall.',
    },
    {
        id: 'guitar-wide',
        descriptor: 'wide',
        roles: ['guitar'],
        title: 'Slow chorus spread with light feedback',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-chorus',
                parameters: [
                    { paramId: 'chorus-rate', minimum: 0.3, maximum: 0.8 },
                    { paramId: 'chorus-depth', minimum: 2, maximum: 5 },
                    { paramId: 'chorus-feedback', minimum: 0.05, maximum: 0.2 },
                    { paramId: 'chorus-mix', minimum: 0.3, maximum: 0.5 },
                ],
            },
        ],
        prerequisites: ['The part can tolerate pitch modulation; a doubled part already provides width without it.'],
        contraindications: [
            'Skip when the mix must fold to mono without comb filtering on this part.',
            'Skip on a part whose tuning is already unstable, which modulation exaggerates.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'increase' },
            { metric: 'stereoCorrelation', direction: 'decrease' },
        ],
        source: 'A slow rate with modest depth spreads the image through delay-time differences rather than through audible vibrato, which is why the rate stays under 1 Hz. Low feedback keeps the modulation from developing the resonant character of a flanger.',
    },
    {
        id: 'guitar-intimate',
        descriptor: 'intimate',
        roles: ['guitar'],
        title: 'Short room at a low mix',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-reverb',
                parameters: [
                    { paramId: 'rev-size', minimum: 0.25, maximum: 0.4 },
                    { paramId: 'rev-decay', minimum: 0.8, maximum: 1.4 },
                    { paramId: 'rev-predelay', minimum: 20, maximum: 40 },
                    { paramId: 'rev-mix', minimum: 0.1, maximum: 0.2 },
                    { paramId: 'rev-lowcut', minimum: 200, maximum: 400 },
                ],
            },
        ],
        prerequisites: [
            'The recording is reasonably dry; a room-heavy capture cannot be brought closer by adding room.',
        ],
        contraindications: [
            'Skip when a send reverb already places this guitar behind the vocal.',
            'Skip on a dense part where any added tail blurs the rhythmic figure.',
        ],
        metrics: [
            { metric: 'rms', direction: 'increase' },
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
        ],
        source: 'A decay near one second with a short pre-delay reads as a small treated space rather than a hall, so the guitar gains context without moving backwards. The low cut above 200 Hz keeps the tail from thickening the body region the warm recipe works in.',
    },
    {
        id: 'guitar-dark',
        descriptor: 'dark',
        roles: ['guitar'],
        title: 'Presence and top shelf brought down',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 5000, maximum: 9000 },
                    { paramId: 'eq-high-gain', minimum: -6, maximum: -3 },
                    { paramId: 'eq-mid-freq', minimum: 2500, maximum: 4000 },
                    { paramId: 'eq-mid-gain', minimum: -3, maximum: -1 },
                    { paramId: 'eq-mid-q', minimum: 0.8, maximum: 1.5 },
                ],
            },
        ],
        prerequisites: ['The part still reads rhythmically after the cut; darkening costs pick definition.'],
        contraindications: [
            'Skip when the guitar already sits behind the arrangement.',
            'Skip on a part recorded through an already dull chain with no top to remove.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'decrease' },
        ],
        source: 'The shelf removes shimmer and the bell removes the forward pick region, and cutting only one of the two leaves the part still reading bright. Holding both under 6 dB keeps the guitar audible instead of merely quieter.',
    },
    {
        id: 'guitar-airy',
        descriptor: 'airy',
        roles: ['guitar'],
        title: 'Wide shelf above the string region',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 10000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: 2, maximum: 3.5 },
                    { paramId: 'eq-high-q', minimum: 0.5, maximum: 0.8 },
                ],
            },
        ],
        prerequisites: [
            'The capture carries content above 10 kHz rather than stopping at a cabinet simulation ceiling.',
        ],
        contraindications: [
            'Skip on a speaker-simulated electric part, which has almost no content above 6 kHz to lift.',
            'Skip when amplifier hiss is audible between phrases.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'increase' },
        ],
        source: 'Air on a guitar comes from string and body noise above 10 kHz, which acoustic captures have and speaker-simulated electric parts largely do not. A wide slope keeps the lift from settling on one string overtone and ringing.',
    },
    {
        id: 'guitar-muddy',
        descriptor: 'muddy',
        roles: ['guitar'],
        title: 'Clear the boxy region between body and mids',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 250, maximum: 400 },
                    { paramId: 'eq-mid-gain', minimum: -5, maximum: -2 },
                    { paramId: 'eq-mid-q', minimum: 1.2, maximum: 2.5 },
                    { paramId: 'eq-low-freq', minimum: 120, maximum: 180 },
                    { paramId: 'eq-low-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: ['The buildup is audible on the soloed guitar rather than only against the bass and vocal.'],
        contraindications: [
            'Skip when the guitar already sounds thin on its own.',
            'Skip when a parent bus already carries the same corrective cut.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'decrease' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'Guitar mud gathers between 250 Hz and 400 Hz, below the mid band the descriptor usually reaches, because that is where cabinet and body resonance overlap with everything else in the arrangement. The shallow shelf underneath removes the broad shoulder the bell alone leaves behind.',
    },
    {
        id: 'guitar-thin',
        descriptor: 'thin',
        roles: ['guitar'],
        title: 'Restore body and lower-mid fill',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 100, maximum: 160 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-mid-freq', minimum: 300, maximum: 500 },
                    { paramId: 'eq-mid-gain', minimum: 1, maximum: 2.5 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: ['No steep high pass earlier in the chain is removing the region this recipe rebuilds.'],
        contraindications: [
            'Skip when several guitars are layered, where the same lift on each compounds into mud.',
            'Skip when the bass already fills the region below 160 Hz.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'A thin guitar is usually missing body around 120 Hz and fill around 400 Hz rather than either alone, so the shelf and the broad bell work together. Each stays under 4 dB because the same lift applied to every layered guitar adds up far faster than it does on one.',
    },
    {
        id: 'guitar-glued',
        descriptor: 'glued',
        roles: ['guitar'],
        title: 'Gentle second-stage compression across the part',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -18, maximum: -10 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 120, maximum: 250 },
                    { paramId: 'comp-knee', minimum: 6, maximum: 10 },
                ],
            },
        ],
        prerequisites: [
            'An earlier stage already handles peak control, so this stage can stay under a few decibels of reduction.',
        ],
        contraindications: [
            'Skip when no earlier stage controls peaks; this one alone will chase them and pump.',
            'Skip on a sustained pad-like part with no dynamic movement to settle.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'Cohesion comes from a slow shared gain envelope rather than from peak control, which is why the knee is soft and the release spans several strums. Splitting the work across two gentle stages keeps each one below the point where the envelope becomes audible.',
    },
    {
        id: 'guitar-lo-fi',
        descriptor: 'lo-fi',
        roles: ['guitar'],
        title: 'Bit reduction into a narrow band',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-bitcrusher',
                parameters: [
                    { paramId: 'crush-bits', minimum: 4, maximum: 8 },
                    { paramId: 'crush-rate', minimum: 2, maximum: 10 },
                    { paramId: 'crush-mix', minimum: 0.3, maximum: 0.6 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-filter',
                parameters: [
                    { paramId: 'filter-type', minimum: 0, maximum: 0 },
                    { paramId: 'filter-cutoff', minimum: 2000, maximum: 4000 },
                    { paramId: 'filter-resonance', minimum: 0.5, maximum: 1.5 },
                ],
            },
        ],
        prerequisites: ['The degraded character is a deliberate choice for this part or section.'],
        contraindications: [
            'Skip when this guitar carries the top of the arrangement.',
            'Skip when downstream limiting would pull the added noise floor up between phrases.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Rate reduction folds aliases above the audio band back down into it, so the low pass sits after the crusher and removes the fizz while keeping the grit. A partial mix keeps the chord shape legible under the artefacts.',
    },
    {
        id: 'guitar-vintage',
        descriptor: 'vintage',
        roles: ['guitar'],
        title: 'Low-order drive into a short filtered slap',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-distortion',
                parameters: [
                    { paramId: 'dist-drive', minimum: 15, maximum: 30 },
                    { paramId: 'dist-tone', minimum: 2000, maximum: 3500 },
                    { paramId: 'dist-mix', minimum: 0.35, maximum: 0.6 },
                    { paramId: 'dist-output', minimum: -8, maximum: -3 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-delay',
                parameters: [
                    { paramId: 'delay-time', minimum: 80, maximum: 140 },
                    { paramId: 'delay-feedback', minimum: 0.15, maximum: 0.3 },
                    { paramId: 'delay-mix', minimum: 0.15, maximum: 0.28 },
                    { paramId: 'delay-highcut', minimum: 4000, maximum: 7000 },
                    { paramId: 'delay-lowcut', minimum: 200, maximum: 500 },
                ],
            },
        ],
        prerequisites: [
            'Level into the drive stage is already controlled, because drive responds to input level as much as to its own control.',
        ],
        contraindications: [
            'Skip at tempi where a 100 ms repeat lands on a subdivision and reads as a rhythmic part.',
            'Skip when the arrangement needs this guitar dry and modern.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'spectralRolloff', direction: 'decrease' },
        ],
        source: 'A short single repeat under 150 ms with a band-limited tail is the classic period ambience, and filtering the repeat above 4 kHz and below 200 Hz keeps it behind the dry part rather than beside it. Low-order drive supplies the harmonic character without the sustain of modern high-gain distortion.',
    },
];
