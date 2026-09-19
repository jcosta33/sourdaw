import { type MixRecipe } from '../../models/MixRecipe';

/** Authored mixing recipes for the master output chain. */
export const masterMixRecipes: readonly MixRecipe[] = [
    {
        id: 'master-warm',
        descriptor: 'warm',
        roles: ['master'],
        title: 'Very shallow downward tilt',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 80, maximum: 140 },
                    { paramId: 'eq-low-gain', minimum: 0.5, maximum: 1.5 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: -1.5, maximum: -0.5 },
                ],
            },
        ],
        prerequisites: ['The mix balance is settled; a master tilt is not a substitute for fixing a source.'],
        contraindications: [
            'Skip when one source is responsible for the imbalance.',
            'Skip when downstream limiting is already reducing more than a couple of decibels.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
        ],
        source: 'Master moves land on everything, so a decibel and a half is a large change rather than a small one; anything bigger is a mix problem wearing a master fix. A matched shelf pair tilts the balance without raising the level the limiter then has to remove.',
    },
    {
        id: 'master-bright',
        descriptor: 'bright',
        roles: ['master'],
        title: 'Shallow presence and top lift',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 2000, maximum: 4000 },
                    { paramId: 'eq-mid-gain', minimum: 0.3, maximum: 1 },
                    { paramId: 'eq-mid-q', minimum: 0.6, maximum: 1 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: 0.5, maximum: 1.5 },
                ],
            },
        ],
        prerequisites: [
            'The mix has been checked on more than one playback system; master brightness is the easiest move to misjudge on one.',
        ],
        contraindications: [
            'Skip when the mix already reads harsh on any reference system.',
            'Skip when the dullness traces to one source that could be fixed at its track.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'increase' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'increase' },
        ],
        source: 'A broad lift in the presence region raises whatever is loudest there across the whole mix, so it stays under a decibel and the shelf above it carries most of the perceived change. Wide, shallow curves are what keep a master move from re-voicing individual sources.',
    },
    {
        id: 'master-tight',
        descriptor: 'tight',
        roles: ['master'],
        title: 'Retune the output limiter for shorter recovery',
        steps: [
            {
                kind: 'edit',
                deviceType: 'builtin-limiter',
                parameters: [
                    { paramId: 'lim-release', minimum: 30, maximum: 80 },
                    { paramId: 'lim-threshold', minimum: -6, maximum: -2 },
                    { paramId: 'lim-ceiling', minimum: -1, maximum: -0.3 },
                ],
            },
        ],
        prerequisites: [
            'A limiter of type builtin-limiter already sits last in the master chain; this recipe retunes it rather than adding a second one.',
        ],
        contraindications: [
            'Skip when the mix is dense enough that a release under 80 ms produces audible distortion on sustained low notes.',
            'Skip when the delivery target requires more headroom than a ceiling near -0.3 dB leaves.',
        ],
        metrics: [
            { metric: 'truePeak', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'Shortening limiter release recovers gain between peaks and reads as a tighter, more controlled master; keeping the ceiling below 0 dB leaves room for the intersample peaks that lossy encoding produces. A second limiter would stack two release envelopes instead, which is why this is an edit.',
    },
    {
        id: 'master-punchy',
        descriptor: 'punchy',
        roles: ['master'],
        title: 'Slow master compression that lets peaks pass',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -16, maximum: -8 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 100, maximum: 200 },
                    { paramId: 'comp-knee', minimum: 4, maximum: 10 },
                ],
            },
        ],
        prerequisites: [
            'The mix still has transients at the master; a heavily limited mix bus has nothing left to let through.',
        ],
        contraindications: [
            'Skip when a limiter earlier in the master chain has already removed the peaks.',
            'Skip when the release cannot recover between beats at this tempo, which produces pumping across the whole mix.',
        ],
        metrics: [
            { metric: 'shortTermLoudnessMax', direction: 'increase' },
            { metric: 'transientDensity', direction: 'hold' },
        ],
        source: 'An attack past the transient leaves the drum strike untouched and clamps the body behind it, so short-term loudness rises while the peak structure survives. Two or three decibels of reduction is the working range on a master; more starts to move the balance between sources.',
    },
    {
        id: 'master-wide',
        descriptor: 'wide',
        roles: ['master'],
        title: 'Small width increase over a summed low end',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-stereo-widener',
                parameters: [
                    { paramId: 'width-amount', minimum: 1.05, maximum: 1.25 },
                    { paramId: 'width-mono-bass', minimum: 100, maximum: 150 },
                    { paramId: 'width-mid', minimum: -1, maximum: 1 },
                ],
            },
        ],
        prerequisites: [
            'The mix has been checked in mono, because master widening is what breaks mono compatibility first.',
        ],
        contraindications: [
            'Skip when individual sources or group buses have already been widened.',
            'Skip when the delivery target sums to mono, such as a club system or a vinyl cut.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'increase' },
            { metric: 'lowFrequencyStereoContent', direction: 'decrease' },
        ],
        source: 'Width applied at the master compounds with every widening move already made below it, so the amount stops near 1.25. Summing below 150 Hz removes the low-frequency stereo content that costs level on mono fold-down and destabilises a vinyl cut.',
    },
    {
        id: 'master-intimate',
        descriptor: 'intimate',
        roles: ['master'],
        title: 'Narrowed image under steady level',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-stereo-widener',
                parameters: [
                    { paramId: 'width-amount', minimum: 0.7, maximum: 0.95 },
                    { paramId: 'width-mono-bass', minimum: 100, maximum: 160 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -16, maximum: -8 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 150, maximum: 250 },
                ],
            },
        ],
        prerequisites: ['The mix is wide enough to narrow; a largely mono mix has no side content to reduce.'],
        contraindications: [
            'Skip when the arrangement depends on a wide, immersive image.',
            'Skip when reverb returns are the main source of the width, where narrowing dries the mix instead of closing it.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'decrease' },
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
        ],
        source: 'Closeness at the master comes from a narrower image and a more constant level rather than from any added ambience, which a master should not introduce. Reducing width below 0.7 starts to collapse the mix to mono rather than bringing it closer.',
    },
    {
        id: 'master-dark',
        descriptor: 'dark',
        roles: ['master'],
        title: 'Shallow top and presence reduction',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 6000, maximum: 10000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                    { paramId: 'eq-mid-freq', minimum: 2500, maximum: 4000 },
                    { paramId: 'eq-mid-gain', minimum: -1.5, maximum: -0.5 },
                    { paramId: 'eq-mid-q', minimum: 0.6, maximum: 1 },
                ],
            },
        ],
        prerequisites: [
            'The mix has been checked on more than one system, because a dark master is easy to create on a bright room.',
        ],
        contraindications: [
            'Skip when the harshness traces to one source that can be fixed at its track.',
            'Skip when the lead vocal already struggles for intelligibility.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'decrease' },
        ],
        source: 'Removing the shelf alone leaves the mix still forward through the presence region, so a shallow bell comes down with it. Both stay within a few decibels because master curves that go further are usually correcting a monitoring problem rather than the mix.',
    },
    {
        id: 'master-airy',
        descriptor: 'airy',
        roles: ['master'],
        title: 'Wide shelf above the musical band',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 12000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: 1, maximum: 2 },
                    { paramId: 'eq-high-q', minimum: 0.5, maximum: 0.8 },
                ],
            },
        ],
        prerequisites: [
            'The mix carries content above 12 kHz rather than being built entirely from band-limited sources.',
        ],
        contraindications: [
            'Skip when the delivery format is a low-bitrate lossy encode, where the added top costs bits the rest of the mix needs.',
            'Skip when noise or sample artefacts are audible in quiet passages.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'increase' },
        ],
        source: 'Above 12 kHz there is almost no musical information, so a shallow wide shelf changes the sense of openness without re-voicing any source. Lossy encoders allocate bits by band, which is why the delivery format is a real contraindication rather than a caution.',
    },
    {
        id: 'master-muddy',
        descriptor: 'muddy',
        roles: ['master'],
        title: 'Shallow cut through the summed low-mid',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 250, maximum: 400 },
                    { paramId: 'eq-mid-gain', minimum: -3, maximum: -1 },
                    { paramId: 'eq-mid-q', minimum: 1, maximum: 2 },
                ],
            },
        ],
        prerequisites: [
            'The buildup survives on several sources at once; a single offending source belongs cut at its own track.',
        ],
        contraindications: [
            'Skip when one source is responsible for the buildup.',
            'Skip when the mix already reads thin through the lower mids on a reference system.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'decrease' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'When every source contributes a little energy between 250 Hz and 400 Hz the sum reads muddy even though no track does, and that is the only case a master cut answers honestly. A moderate Q clears the region without notching out the body of the mix.',
    },
    {
        id: 'master-thin',
        descriptor: 'thin',
        roles: ['master'],
        title: 'Shallow weight restored at the bottom',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 60, maximum: 120 },
                    { paramId: 'eq-low-gain', minimum: 1, maximum: 2.5 },
                    { paramId: 'eq-mid-freq', minimum: 200, maximum: 350 },
                    { paramId: 'eq-mid-gain', minimum: 0.5, maximum: 1.5 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: ['The monitoring path reproduces below 100 Hz, or the lift cannot be judged at all.'],
        contraindications: [
            'Skip when downstream limiting is already reducing more than a couple of decibels, because low-end lift costs the most headroom.',
            'Skip when the thinness traces to one source missing its fundamental.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'busHeadroom', direction: 'decrease' },
        ],
        source: 'Low-frequency energy consumes more headroom per decibel than any other band, so the master lift stays under 2.5 dB and the headroom cost is stated as an expected consequence. The broad bell above the shelf fills the region between weight and body without adding a resonance.',
    },
    {
        id: 'master-glued',
        descriptor: 'glued',
        roles: ['master'],
        title: 'One slow envelope across the whole mix',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -14, maximum: -6 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 25, maximum: 30 },
                    { paramId: 'comp-release', minimum: 150, maximum: 250 },
                    { paramId: 'comp-knee', minimum: 6, maximum: 10 },
                ],
            },
        ],
        prerequisites: [
            'The mix balance is settled, because master compression moves loud sources relative to quiet ones.',
        ],
        contraindications: [
            'Skip when a mix-bus compressor already applies the same slow envelope.',
            'Skip when one loud element, usually the kick, would drive the detector on its own.',
        ],
        metrics: [
            { metric: 'integratedLoudness', direction: 'increase' },
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
        ],
        source: 'A single slow envelope across the mix raises the average level relative to the peaks, which is what integrated loudness measures and what cohesion sounds like. Keeping reduction to two or three decibels stops the envelope becoming audible as pumping on the whole programme.',
    },
    {
        id: 'master-lo-fi',
        descriptor: 'lo-fi',
        roles: ['master'],
        title: 'Mix-wide quantisation under a band limit',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-bitcrusher',
                parameters: [
                    { paramId: 'crush-bits', minimum: 6, maximum: 10 },
                    { paramId: 'crush-rate', minimum: 2, maximum: 6 },
                    { paramId: 'crush-mix', minimum: 0.2, maximum: 0.4 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-filter',
                parameters: [
                    { paramId: 'filter-type', minimum: 0, maximum: 0 },
                    { paramId: 'filter-cutoff', minimum: 4000, maximum: 8000 },
                    { paramId: 'filter-resonance', minimum: 0.5, maximum: 1 },
                ],
            },
        ],
        prerequisites: [
            'The degraded character is the intended sound of the finished release rather than a section effect.',
        ],
        contraindications: [
            'Skip on any master intended as a clean delivery.',
            'Skip when a limiter follows this point, because it will pull the added quantisation noise up in every gap.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'At the master the crusher acts on the sum, so bit depth stays higher than a single-track treatment would use and the mix stays partly dry underneath. The low pass after it removes the aliased fizz while leaving the quantisation grain that carries the character.',
    },
    {
        id: 'master-vintage',
        descriptor: 'vintage',
        roles: ['master'],
        title: 'Low-order harmonics under a rolled top',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-distortion',
                parameters: [
                    { paramId: 'dist-drive', minimum: 8, maximum: 18 },
                    { paramId: 'dist-tone', minimum: 3000, maximum: 4500 },
                    { paramId: 'dist-mix', minimum: 0.2, maximum: 0.35 },
                    { paramId: 'dist-output', minimum: -6, maximum: -2 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 10000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: -2, maximum: -0.5 },
                ],
            },
        ],
        prerequisites: [
            'Level into the drive stage is controlled, because drive responds to input level as much as to its own control.',
        ],
        contraindications: [
            'Skip when the release must be a transparent, wide-bandwidth master.',
            'Skip when a limiter follows closely, where the added harmonics raise peak level and force extra reduction.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'The drive window sits below the mix window used on a single track because harmonics generated on a sum are audible far sooner than the same amount on one source. Pairing it with a gentle top-end roll matches the reduced bandwidth of period delivery formats without removing the presence the mix needs.',
    },
];
