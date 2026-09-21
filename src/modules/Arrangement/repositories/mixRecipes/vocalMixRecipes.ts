import { type MixRecipe } from '../../models/MixRecipe';

/** Authored mixing recipes for lead and backing vocal sources. */
export const vocalMixRecipes: readonly MixRecipe[] = [
    {
        id: 'vocal-warm',
        descriptor: 'warm',
        roles: ['vocal'],
        title: 'Chest-register lift with a softened upper shelf',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 140, maximum: 180 },
                    { paramId: 'eq-low-gain', minimum: 1.5, maximum: 3 },
                    { paramId: 'eq-high-freq', minimum: 9000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: -2.5, maximum: -0.5 },
                ],
            },
        ],
        prerequisites: ['The vocal track already carries a high-pass or has no room rumble below 80 Hz.'],
        contraindications: [
            'Skip when the vocal already reads congested between 200 Hz and 400 Hz; clear that first.',
            'Skip when the arrangement relies on the vocal to carry the top of the mix.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'Warmth in a voice sits in the chest resonance near 150 Hz, so a shallow shelf there adds body without touching the vowel region. The matching half-decibel-scale cut above 9 kHz keeps the perceived balance tilted downward rather than simply louder, which is what moves spectral centroid instead of level.',
    },
    {
        id: 'vocal-bright',
        descriptor: 'bright',
        roles: ['vocal'],
        title: 'Presence shelf paired with sibilance control',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 11000 },
                    { paramId: 'eq-high-gain', minimum: 2, maximum: 4.5 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-deesser',
                parameters: [
                    { paramId: 'deess-freq', minimum: 6000, maximum: 7500 },
                    { paramId: 'deess-threshold', minimum: -24, maximum: -18 },
                    { paramId: 'deess-range', minimum: -10, maximum: -6 },
                ],
            },
        ],
        prerequisites: ['No high shelf boost is already active on this chain.'],
        contraindications: [
            'Skip when the take is already thin; restore body before lifting the top.',
            'Skip when the recording chain added hiss that a shelf would also raise.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'increase' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'increase' },
        ],
        source: 'A high shelf raises consonants and sibilants together, so the de-esser follows it rather than precedes it and only claws back the narrow 6 kHz to 7.5 kHz sibilant band. Keeping the shelf under 5 dB stops the noise floor rising audibly alongside the wanted detail.',
    },
    {
        id: 'vocal-tight',
        descriptor: 'tight',
        roles: ['vocal'],
        title: 'Level control with a low-end trim',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -24, maximum: -16 },
                    { paramId: 'comp-ratio', minimum: 3, maximum: 5 },
                    { paramId: 'comp-attack', minimum: 5, maximum: 12 },
                    { paramId: 'comp-release', minimum: 60, maximum: 120 },
                    { paramId: 'comp-makeup', minimum: 2, maximum: 5 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 100, maximum: 140 },
                    { paramId: 'eq-low-gain', minimum: -4, maximum: -2 },
                ],
            },
        ],
        prerequisites: ['The performance has usable level throughout; compression cannot rescue an inaudible phrase.'],
        contraindications: [
            'Skip on a take that is already level-ridden or heavily compressed at the source.',
            'Skip when the delivery depends on dynamic contrast between verse and chorus.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
        ],
        source: 'A 3:1 to 5:1 ratio with a release inside a syllable length keeps the vocal at a steady distance without audible pumping. The low shelf trim removes proximity buildup that compression would otherwise pull up along with everything else.',
    },
    {
        id: 'vocal-punchy',
        descriptor: 'punchy',
        roles: ['vocal'],
        title: 'Slow-attack compression that keeps consonant edges',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -22, maximum: -14 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 4 },
                    { paramId: 'comp-attack', minimum: 15, maximum: 30 },
                    { paramId: 'comp-release', minimum: 80, maximum: 150 },
                    { paramId: 'comp-makeup', minimum: 2, maximum: 6 },
                ],
            },
        ],
        prerequisites: ['The take has intact consonant transients rather than a clipped or limited source file.'],
        contraindications: [
            'Skip when a fast peak limiter already sits ahead of this point and has removed the transients.',
            'Skip on whispered or breathy delivery, where the same settings pull up noise between words.',
        ],
        metrics: [
            { metric: 'rms', direction: 'increase' },
            { metric: 'transientDensity', direction: 'hold' },
        ],
        source: 'An attack longer than the consonant burst lets the burst pass uncompressed and clamps only the sustained vowel behind it, which is what reads as punch. Makeup gain restores the lost sustain level so the average rises while the peak count does not.',
    },
    {
        id: 'vocal-wide',
        descriptor: 'wide',
        roles: ['vocal'],
        title: 'Modest side-energy lift with a mono low end',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-stereo-widener',
                parameters: [
                    { paramId: 'width-amount', minimum: 1.1, maximum: 1.4 },
                    { paramId: 'width-mono-bass', minimum: 120, maximum: 180 },
                    { paramId: 'width-side', minimum: 0, maximum: 2 },
                ],
            },
        ],
        prerequisites: ['The source is a stereo track: a doubled take, a stereo pair, or an already-spread group.'],
        contraindications: [
            'Skip on a single centred lead vocal, where widening moves it off the centre image.',
            'Skip when the mix must fold to mono without level loss on the vocal.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'increase' },
            { metric: 'stereoCorrelation', direction: 'decrease' },
        ],
        source: 'Widening beyond about 1.4 starts to hollow the centre on mono fold-down, so the window stops short of it. Keeping everything under 180 Hz mono preserves the low end that width processing would otherwise decorrelate.',
    },
    {
        id: 'vocal-intimate',
        descriptor: 'intimate',
        roles: ['vocal'],
        title: 'Short close ambience under gentle level control',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-reverb',
                parameters: [
                    { paramId: 'rev-size', minimum: 0.25, maximum: 0.4 },
                    { paramId: 'rev-decay', minimum: 0.8, maximum: 1.4 },
                    { paramId: 'rev-predelay', minimum: 20, maximum: 35 },
                    { paramId: 'rev-mix', minimum: 0.08, maximum: 0.16 },
                    { paramId: 'rev-lowcut', minimum: 200, maximum: 400 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -22, maximum: -14 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 10, maximum: 25 },
                    { paramId: 'comp-release', minimum: 100, maximum: 200 },
                ],
            },
        ],
        prerequisites: [
            'The recording is reasonably dry; a room-heavy take cannot be made closer by adding more room.',
        ],
        contraindications: [
            'Skip when a long send reverb already places this vocal far back; shorten that instead.',
            'Skip on a dense arrangement that needs the vocal to project rather than sit close.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'rms', direction: 'increase' },
        ],
        source: 'A decay near one second with a short pre-delay reads as a small treated space rather than a hall, and the low cut above 200 Hz stops the tail thickening the chest register. Gentle compression holds the quiet phrases forward, which is most of what closeness means.',
    },
    {
        id: 'vocal-dark',
        descriptor: 'dark',
        roles: ['vocal'],
        title: 'Upper shelf cut with an upper-mid dip',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 6000, maximum: 9000 },
                    { paramId: 'eq-high-gain', minimum: -6, maximum: -3 },
                    { paramId: 'eq-mid-freq', minimum: 2500, maximum: 4000 },
                    { paramId: 'eq-mid-gain', minimum: -3, maximum: -1 },
                    { paramId: 'eq-mid-q', minimum: 1, maximum: 2 },
                ],
            },
        ],
        prerequisites: ['The vocal is intelligible before the cut; darkening reduces consonant definition.'],
        contraindications: [
            'Skip when the vocal already loses the lyric against the arrangement.',
            'Skip when the source was recorded through a dull chain and has no top to remove.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'decrease' },
        ],
        source: 'Darkness needs both the shelf and the upper-mid bell: the shelf removes air while the narrow dip near 3 kHz removes the forwardness that still reads as bright after the shelf. Holding the bell above 1 in Q keeps the vowel region untouched.',
    },
    {
        id: 'vocal-airy',
        descriptor: 'airy',
        roles: ['vocal'],
        title: 'High shelf above the sibilant band with sibilance held',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-deesser',
                parameters: [
                    { paramId: 'deess-freq', minimum: 6000, maximum: 7500 },
                    { paramId: 'deess-threshold', minimum: -22, maximum: -16 },
                    { paramId: 'deess-range', minimum: -8, maximum: -4 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 12000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: 1.5, maximum: 3.5 },
                    { paramId: 'eq-high-q', minimum: 0.5, maximum: 0.8 },
                ],
            },
        ],
        prerequisites: ['The source was captured at a sample rate and bandwidth that carry content above 12 kHz.'],
        contraindications: [
            'Skip on a source restored from a band-limited file, where the shelf lifts only noise.',
            'Skip when the mix bus already carries a broad air lift.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'increase' },
        ],
        source: 'Placing the de-esser before the shelf lets it hold the sibilant band while the shelf raises only what sits above it, so air arrives without the sting. A wide shelf slope keeps the lift from reading as a resonance.',
    },
    {
        id: 'vocal-muddy',
        descriptor: 'muddy',
        roles: ['vocal'],
        title: 'Clear the low-mid buildup that masks the vocal',
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
        prerequisites: ['The muddiness is audible on the solo vocal, not only in the full mix.'],
        contraindications: [
            'Skip when the vocal already sounds thin on its own; the buildup then belongs to another source.',
            'Skip when a corrective low-mid cut is already in the chain.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'decrease' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'Vocal mud collects between 250 Hz and 400 Hz where proximity effect and room modes overlap, which is below the mid band the descriptor normally reaches; the narrower Q keeps the cut off the vowel fundamentals just above it. The shallower low shelf removes the broad shoulder underneath without hollowing the chest.',
    },
    {
        id: 'vocal-thin',
        descriptor: 'thin',
        roles: ['vocal'],
        title: 'Restore fundamental and lower-mid weight',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 120, maximum: 180 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-mid-freq', minimum: 400, maximum: 700 },
                    { paramId: 'eq-mid-gain', minimum: 1, maximum: 2.5 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: [
            'The source retains content below 200 Hz; a steep high pass earlier in the chain must be relaxed first.',
        ],
        contraindications: [
            'Skip when the vocal shares the low-mid region with a dense guitar or keys bed already fighting it.',
            'Skip on a source recorded very close, where the weight is present but masked rather than missing.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'A thin vocal is usually missing the fundamental octave rather than the harmonics, so the shelf sits at the low end of the singing range and the broad bell fills the first harmonic region above it. Both lifts stay under 4 dB because more turns weight into boxiness.',
    },
    {
        id: 'vocal-glued',
        descriptor: 'glued',
        roles: ['vocal'],
        title: 'Second-stage slow compression for a constant seat',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -20, maximum: -12 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 120, maximum: 250 },
                    { paramId: 'comp-knee', minimum: 6, maximum: 10 },
                ],
            },
        ],
        prerequisites: ['A first compression stage already handles peak control on this chain.'],
        contraindications: [
            'Skip when no earlier stage controls peaks; this stage alone will chase them and pump.',
            'Skip when the vocal is a single sustained pad-like part with no dynamic movement to settle.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'Splitting the work across two gentle stages keeps each one under a few decibels of reduction, which is why the second stage uses a soft knee and a long release. The second stage sets the constant seat in the mix; it is not where peaks are caught.',
    },
    {
        id: 'vocal-lo-fi',
        descriptor: 'lo-fi',
        roles: ['vocal'],
        title: 'Bit reduction into a band-limiting low pass',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-bitcrusher',
                parameters: [
                    { paramId: 'crush-bits', minimum: 5, maximum: 8 },
                    { paramId: 'crush-rate', minimum: 3, maximum: 10 },
                    { paramId: 'crush-mix', minimum: 0.3, maximum: 0.6 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-filter',
                parameters: [
                    { paramId: 'filter-type', minimum: 0, maximum: 0 },
                    { paramId: 'filter-cutoff', minimum: 2500, maximum: 4000 },
                    { paramId: 'filter-resonance', minimum: 0.5, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: [
            'The part is a deliberate effect vocal or a section treatment rather than the main lyric delivery.',
        ],
        contraindications: [
            'Skip on the lead vocal of a section whose lyric must stay intelligible.',
            'Skip when downstream limiting will amplify the aliasing this adds.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Bit reduction adds broadband quantisation noise and rate reduction adds aliases above the audio band, so the low pass follows rather than precedes it and removes both. Keeping the crush mix partial leaves enough of the original to track the lyric.',
    },
    {
        id: 'vocal-vintage',
        descriptor: 'vintage',
        roles: ['vocal'],
        title: 'Low-drive saturation under a rolled top end',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-distortion',
                parameters: [
                    { paramId: 'dist-drive', minimum: 10, maximum: 20 },
                    { paramId: 'dist-tone', minimum: 2500, maximum: 4000 },
                    { paramId: 'dist-mix', minimum: 0.3, maximum: 0.45 },
                    { paramId: 'dist-output', minimum: -6, maximum: -2 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 10000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: [
            'Level into the saturation stage is controlled; drive reacts to input level as much as to its own setting.',
        ],
        contraindications: [
            'Skip when the vocal must stay transparent against a modern, wide-bandwidth production.',
            'Skip when an earlier stage already adds harmonic distortion.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Older recording chains read as vintage mostly through added low-order harmonics and reduced bandwidth, so a small amount of drive is paired with a gentle top-end roll rather than with heavy distortion. Negative output trim keeps the added harmonics from raising the level and flattering the comparison.',
    },
];
