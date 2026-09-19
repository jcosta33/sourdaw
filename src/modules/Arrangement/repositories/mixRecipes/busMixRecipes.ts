import { type MixRecipe } from '../../models/MixRecipe';

/** Authored mixing recipes for group and submix buses carrying several sources. */
export const busMixRecipes: readonly MixRecipe[] = [
    {
        id: 'bus-warm',
        descriptor: 'warm',
        roles: ['bus'],
        title: 'Shallow tilt across the group',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 100, maximum: 160 },
                    { paramId: 'eq-low-gain', minimum: 1.5, maximum: 3 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: -2, maximum: -0.5 },
                ],
            },
        ],
        prerequisites: ['The sources feeding the bus are already balanced against each other.'],
        contraindications: [
            'Skip when individual sources need different amounts of the same move.',
            'Skip when the parent chain already applies a tilt in the same direction.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'A bus move lands on every source at once, so the amounts stay roughly half of what a single track would take. A shallow tilt in both directions changes character while leaving the internal balance of the group untouched.',
    },
    {
        id: 'bus-bright',
        descriptor: 'bright',
        roles: ['bus'],
        title: 'Group presence and top raised gently',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 2500, maximum: 4000 },
                    { paramId: 'eq-mid-gain', minimum: 1, maximum: 2 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: 1.5, maximum: 3 },
                ],
            },
        ],
        prerequisites: ['The group does not already collide with the lead vocal in the presence region.'],
        contraindications: [
            'Skip when only one source in the group needs the lift.',
            'Skip when a downstream bus already applies a top-end boost.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'increase' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'increase' },
        ],
        source: 'Boosting a shared presence region on a group raises whichever source is loudest there, which is why the bell is wide and shallow rather than targeted. Anything steeper belongs on the individual track that needs it.',
    },
    {
        id: 'bus-tight',
        descriptor: 'tight',
        roles: ['bus'],
        title: 'Group level controlled over a trimmed low shoulder',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 60, maximum: 100 },
                    { paramId: 'eq-low-gain', minimum: -3, maximum: -1 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -20, maximum: -12 },
                    { paramId: 'comp-ratio', minimum: 3, maximum: 5 },
                    { paramId: 'comp-attack', minimum: 10, maximum: 20 },
                    { paramId: 'comp-release', minimum: 60, maximum: 120 },
                ],
            },
        ],
        prerequisites: ['The bus carries several sources whose combined low end is what drives the reduction.'],
        contraindications: [
            'Skip when the group is the only low-frequency source in the mix.',
            'Skip when one source in the group is loud enough that the compressor only ever tracks that one.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'busHeadroom', direction: 'increase' },
        ],
        source: 'Summing several sources stacks their low-frequency shoulders, so trimming that region before compression stops it dominating the detector. The shorter release then shortens the decay of the group as a whole, which is what tightness means at bus level.',
    },
    {
        id: 'bus-punchy',
        descriptor: 'punchy',
        roles: ['bus'],
        title: 'Retune the group compressor to let transients through',
        steps: [
            {
                kind: 'edit',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 60, maximum: 120 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 4 },
                    { paramId: 'comp-makeup', minimum: 1, maximum: 4 },
                ],
            },
        ],
        prerequisites: [
            'A compressor of type builtin-compressor already sits on this bus; this recipe retunes it rather than adding a second stage.',
        ],
        contraindications: [
            'Skip when the existing compressor is doing the peak control the chain depends on.',
            'Skip when the sources feeding the bus have already been individually limited.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'increase' },
            { metric: 'transientDensity', direction: 'hold' },
        ],
        source: 'A second compressor on a bus that already has one usually costs more than it gains, so the punch comes from lengthening the existing attack past the transient and shortening its release. Stacking a slow stage on a fast one instead produces two overlapping envelopes and audible pumping.',
    },
    {
        id: 'bus-wide',
        descriptor: 'wide',
        roles: ['bus'],
        title: 'Group spread with the low end summed',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-stereo-widener',
                parameters: [
                    { paramId: 'width-amount', minimum: 1.15, maximum: 1.4 },
                    { paramId: 'width-mono-bass', minimum: 100, maximum: 160 },
                    { paramId: 'width-mid', minimum: -1, maximum: 1 },
                ],
            },
        ],
        prerequisites: [
            'The group already has internal stereo differences; widening a summed mono group only produces phase artefacts.',
        ],
        contraindications: [
            'Skip when the group contains the only centred anchor of the mix.',
            'Skip when a downstream bus already widens this material.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'increase' },
            { metric: 'lowFrequencyStereoContent', direction: 'hold' },
        ],
        source: 'Widening compounds down the bus chain, so a group stays under about 1.4 to leave the parent bus somewhere to go. The mono crossover keeps the summed low end of several sources from decorrelating, which is where width damage shows first.',
    },
    {
        id: 'bus-intimate',
        descriptor: 'intimate',
        roles: ['bus'],
        title: 'Shared short room at a low mix',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-reverb',
                parameters: [
                    { paramId: 'rev-size', minimum: 0.3, maximum: 0.45 },
                    { paramId: 'rev-decay', minimum: 1, maximum: 1.6 },
                    { paramId: 'rev-predelay', minimum: 25, maximum: 45 },
                    { paramId: 'rev-mix', minimum: 0.08, maximum: 0.16 },
                    { paramId: 'rev-lowcut', minimum: 200, maximum: 400 },
                ],
            },
        ],
        prerequisites: ['The sources on this bus belong in the same space; a shared room asserts that they do.'],
        contraindications: [
            'Skip when individual sources already carry their own ambience.',
            'Skip when the group must stay dry against a wetter arrangement.',
        ],
        metrics: [
            { metric: 'rms', direction: 'increase' },
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
        ],
        source: 'One short room across a group binds its sources more convincingly than the same reverb applied to each, because the early reflections then agree. The mix stays low and the low cut sits above 200 Hz so the group gains a place rather than a tail.',
    },
    {
        id: 'bus-dark',
        descriptor: 'dark',
        roles: ['bus'],
        title: 'Group top and presence eased down',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 6000, maximum: 10000 },
                    { paramId: 'eq-high-gain', minimum: -5, maximum: -2 },
                    { paramId: 'eq-mid-freq', minimum: 3000, maximum: 5000 },
                    { paramId: 'eq-mid-gain', minimum: -2, maximum: -0.5 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: ['Every source on the bus can afford the same reduction.'],
        contraindications: [
            'Skip when one source in the group carries the top of the arrangement.',
            'Skip when the group already sits behind the mix.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'decrease' },
        ],
        source: 'Cutting the shelf alone leaves the group still forward through the presence region, so a shallow bell comes down with it. Bus amounts stay smaller than track amounts because the move lands on every source at once.',
    },
    {
        id: 'bus-airy',
        descriptor: 'airy',
        roles: ['bus'],
        title: 'Shared air shelf above the detail region',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 12000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: 1.5, maximum: 3 },
                    { paramId: 'eq-high-q', minimum: 0.5, maximum: 0.8 },
                ],
            },
        ],
        prerequisites: ['The sources on this bus carry content above 12 kHz.'],
        contraindications: [
            'Skip when the group includes band-limited samples whose noise floor would rise instead.',
            'Skip when a downstream bus already applies an air lift.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'increase' },
        ],
        source: 'Above 12 kHz almost no source carries musical information, so a shallow shelf there adds openness without changing the balance between the sources on the bus. A wide slope keeps the lift from settling on any one source that happens to peak there.',
    },
    {
        id: 'bus-muddy',
        descriptor: 'muddy',
        roles: ['bus'],
        title: 'Clear the summed low-mid buildup',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 250, maximum: 400 },
                    { paramId: 'eq-mid-gain', minimum: -4, maximum: -1.5 },
                    { paramId: 'eq-mid-q', minimum: 1.2, maximum: 2.5 },
                ],
            },
        ],
        prerequisites: [
            'The buildup is a property of the sum rather than of one source that could be cut on its own track.',
        ],
        contraindications: [
            'Skip when one source is responsible; cut it there instead of thinning the whole group.',
            'Skip when the group already sounds hollow in the lower mids.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'decrease' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'Several sources each carrying a modest 250 Hz to 400 Hz shoulder sum into a buildup none of them shows alone, which is exactly the case a bus cut answers. The bell sits below the mid band the descriptor usually reaches because that is where the summation happens.',
    },
    {
        id: 'bus-thin',
        descriptor: 'thin',
        roles: ['bus'],
        title: 'Rebuild shared weight across the group',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 80, maximum: 140 },
                    { paramId: 'eq-low-gain', minimum: 1.5, maximum: 3 },
                    { paramId: 'eq-mid-freq', minimum: 250, maximum: 400 },
                    { paramId: 'eq-mid-gain', minimum: 0.5, maximum: 2 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: [
            'Every source on the bus is missing the same weight; otherwise the fix belongs on the source that is thin.',
        ],
        contraindications: [
            'Skip when only one source is thin.',
            'Skip when the group shares its register with the bass part.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'busHeadroom', direction: 'decrease' },
        ],
        source: 'A low-end lift on a bus stacks across every source feeding it, so bus amounts stay near half of single-track amounts and the headroom cost is stated as an expected consequence rather than a surprise. The broad bell above the shelf fills the region between weight and body without narrow resonance.',
    },
    {
        id: 'bus-glued',
        descriptor: 'glued',
        roles: ['bus'],
        title: 'Slow shared gain envelope across the group',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -18, maximum: -10 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 150, maximum: 250 },
                    { paramId: 'comp-knee', minimum: 6, maximum: 10 },
                ],
            },
        ],
        prerequisites: [
            'The internal balance of the group is already right; bus compression binds sources, it does not balance them.',
        ],
        contraindications: [
            'Skip when one source dominates the detector and pulls the whole group down with it.',
            'Skip when a compressor already sits on this bus; retune that one instead.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'busHeadroom', direction: 'increase' },
        ],
        source: 'Glue is the audible consequence of every source on a bus sharing one slow gain envelope, which needs a soft knee and a release long enough to span a bar rather than a beat. Two or three decibels of reduction is the working range; past that the envelope itself becomes the thing you hear.',
    },
    {
        id: 'bus-lo-fi',
        descriptor: 'lo-fi',
        roles: ['bus'],
        title: 'Group-wide quantisation under a band limit',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-bitcrusher',
                parameters: [
                    { paramId: 'crush-bits', minimum: 5, maximum: 9 },
                    { paramId: 'crush-rate', minimum: 2, maximum: 8 },
                    { paramId: 'crush-mix', minimum: 0.25, maximum: 0.5 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-filter',
                parameters: [
                    { paramId: 'filter-type', minimum: 0, maximum: 0 },
                    { paramId: 'filter-cutoff', minimum: 3000, maximum: 6000 },
                    { paramId: 'filter-resonance', minimum: 0.5, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: ['The degraded character applies to the whole group rather than to one source within it.'],
        contraindications: [
            'Skip when only one source should be degraded.',
            'Skip when the group carries the top of the arrangement.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Crushing a sum produces intermodulation between sources that crushing each source separately does not, which is the point of doing it on the bus. The low pass after the crusher removes the aliases that read as fizz while leaving the intermodulation that reads as character.',
    },
    {
        id: 'bus-vintage',
        descriptor: 'vintage',
        roles: ['bus'],
        title: 'Plate ambience with the top rolled away',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-convolution-reverb',
                parameters: [
                    { paramId: 'conv-ir', minimum: 3, maximum: 3 },
                    { paramId: 'conv-mix', minimum: 0.2, maximum: 0.32 },
                    { paramId: 'conv-predelay', minimum: 20, maximum: 45 },
                    { paramId: 'conv-lowcut', minimum: 100, maximum: 200 },
                    { paramId: 'conv-highcut', minimum: 5000, maximum: 9000 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 9000, maximum: 13000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: [
            'The sources on this bus are dry enough that a shared ambience is not a second space stacked on a first.',
        ],
        contraindications: [
            'Skip when the group must stay dry and modern.',
            'Skip when individual sources already carry period ambience of their own.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'rms', direction: 'increase' },
        ],
        source: 'A plate impulse has a dense onset with no discrete early reflections, which is why it binds a group without placing it in a recognisable room. Band-limiting the tail between 100 Hz and 9 kHz matches the bandwidth period plates actually had and keeps the ambience behind the dry sources.',
    },
];
