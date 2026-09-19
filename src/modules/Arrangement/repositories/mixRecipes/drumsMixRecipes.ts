import { type MixRecipe } from '../../models/MixRecipe';

/** Authored mixing recipes for drum kits, loops, and drum group buses. */
export const drumsMixRecipes: readonly MixRecipe[] = [
    {
        id: 'drums-warm',
        descriptor: 'warm',
        roles: ['drums'],
        title: 'Shell weight lifted, cymbal shelf eased',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 80, maximum: 120 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: [
            'The kit has real low-frequency content; a sample set filtered above 100 Hz has nothing to lift.',
        ],
        contraindications: [
            'Skip when the low end is already competing with the bass part.',
            'Skip when the cymbals carry the rhythmic detail the arrangement relies on.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'Kick and tom body sits around 80 Hz to 120 Hz, so a shelf there adds weight without reaching the snare fundamental. Easing the cymbal shelf at the same time tilts the whole kit downward rather than just making it louder underneath.',
    },
    {
        id: 'drums-bright',
        descriptor: 'bright',
        roles: ['drums'],
        title: 'Stick attack and cymbal shelf raised together',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 3000, maximum: 5000 },
                    { paramId: 'eq-mid-gain', minimum: 1, maximum: 3 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.5 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: 2, maximum: 4 },
                ],
            },
        ],
        prerequisites: ['Cymbal bleed is under control; a shelf raises bleed and wanted detail equally.'],
        contraindications: [
            'Skip when the kit is already forward and the mix reads harsh.',
            'Skip on heavily clipped loops, where the added top exaggerates the clipping artefacts.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'increase' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'increase' },
        ],
        source: 'Stick and beater attack lives near 4 kHz while cymbal shimmer sits above 8 kHz, and a kit reads bright only when both move. The mid bell stays wide so it lifts the attack region rather than ringing on one drum.',
    },
    {
        id: 'drums-tight',
        descriptor: 'tight',
        roles: ['drums'],
        title: 'Short-release compression over a trimmed low shoulder',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -22, maximum: -14 },
                    { paramId: 'comp-ratio', minimum: 4, maximum: 6 },
                    { paramId: 'comp-attack', minimum: 5, maximum: 15 },
                    { paramId: 'comp-release', minimum: 50, maximum: 100 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 60, maximum: 100 },
                    { paramId: 'eq-low-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: ['The programme is rhythmic enough that a release under 100 ms recovers between hits.'],
        contraindications: [
            'Skip at very fast tempi where a 50 ms release cannot recover between sixteenth notes.',
            'Skip when the kit already sounds gated or truncated.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
        ],
        source: 'A release shorter than the gap between hits shortens the audible decay of each drum, which is the mechanism behind a tight kit rather than any single frequency move. The small low shelf trim removes the sustained shoulder under the kick that the compressor would otherwise lengthen.',
    },
    {
        id: 'drums-punchy',
        descriptor: 'punchy',
        roles: ['drums'],
        title: 'Transient passes, body compresses',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -20, maximum: -12 },
                    { paramId: 'comp-ratio', minimum: 3, maximum: 5 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 60, maximum: 120 },
                    { paramId: 'comp-makeup', minimum: 3, maximum: 6 },
                ],
            },
        ],
        prerequisites: ['The source still has its transients; a pre-limited loop has nothing left to let through.'],
        contraindications: [
            'Skip when a fast peak limiter already sits ahead of this point.',
            'Skip on brushed or very soft playing, where the body is all there is.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'increase' },
            { metric: 'transientDensity', direction: 'hold' },
        ],
        source: 'An attack of 20 ms or longer lets the initial strike through untouched and clamps only the decay behind it, so makeup gain raises the strike relative to the body. Peak-to-average therefore widens even though the average level rises.',
    },
    {
        id: 'drums-wide',
        descriptor: 'wide',
        roles: ['drums'],
        title: 'Overhead spread with the kick held centre',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-stereo-widener',
                parameters: [
                    { paramId: 'width-amount', minimum: 1.2, maximum: 1.5 },
                    { paramId: 'width-mono-bass', minimum: 120, maximum: 180 },
                    { paramId: 'width-side', minimum: 1, maximum: 3 },
                ],
            },
        ],
        prerequisites: ['The kit is a stereo source with genuine left-right differences, not a mono loop.'],
        contraindications: [
            'Skip on a mono kit render, where widening only produces phase artefacts.',
            'Skip when the mix is checked primarily on mono playback systems.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'increase' },
            { metric: 'lowFrequencyStereoContent', direction: 'hold' },
        ],
        source: 'Width on a kit belongs to the overheads and room, not the kick, so the mono crossover sits above the kick fundamental and keeps the low end summed. Stopping at 1.5 keeps the snare from pulling away from the centre image.',
    },
    {
        id: 'drums-intimate',
        descriptor: 'intimate',
        roles: ['drums'],
        title: 'Small-room ambience with the top rolled off',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-convolution-reverb',
                parameters: [
                    { paramId: 'conv-ir', minimum: 0, maximum: 0 },
                    { paramId: 'conv-mix', minimum: 0.2, maximum: 0.32 },
                    { paramId: 'conv-predelay', minimum: 20, maximum: 40 },
                    { paramId: 'conv-lowcut', minimum: 80, maximum: 150 },
                    { paramId: 'conv-highcut', minimum: 5000, maximum: 9000 },
                ],
            },
        ],
        prerequisites: ['The kit is close-miked or sample-based and carries little room of its own.'],
        contraindications: [
            'Skip on a kit already recorded in a live room, where a second space smears the transients.',
            'Skip when the tempo is fast enough that even a small room fills the gaps between hits.',
        ],
        metrics: [
            { metric: 'rms', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'decrease' },
        ],
        source: 'The small-room impulse sits below the range the descriptor usually reaches because closeness is exactly what the larger spaces remove. Rolling the tail above 5 kHz and below 100 Hz stops the room adding cymbal wash or low-end rumble that would read as distance instead of proximity.',
    },
    {
        id: 'drums-dark',
        descriptor: 'dark',
        roles: ['drums'],
        title: 'Cymbal shelf and attack region pulled down',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 6000, maximum: 10000 },
                    { paramId: 'eq-high-gain', minimum: -6, maximum: -2 },
                    { paramId: 'eq-mid-freq', minimum: 3000, maximum: 5000 },
                    { paramId: 'eq-mid-gain', minimum: -3, maximum: -1 },
                    { paramId: 'eq-mid-q', minimum: 0.8, maximum: 1.5 },
                ],
            },
        ],
        prerequisites: ['The groove still reads without the attack region; darkening costs rhythmic definition.'],
        contraindications: [
            'Skip when the kit already sits behind the arrangement.',
            'Skip when the hi-hat is the only element marking the subdivision.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'decrease' },
        ],
        source: 'Removing only the shelf leaves the stick attack forward and the kit still reads bright, so the bell near 4 kHz comes down with it. Both moves stay under 6 dB to keep the kit present rather than buried.',
    },
    {
        id: 'drums-airy',
        descriptor: 'airy',
        roles: ['drums'],
        title: 'Air shelf above the cymbal body',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 12000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-high-q', minimum: 0.5, maximum: 0.8 },
                    { paramId: 'eq-mid-freq', minimum: 500, maximum: 800 },
                    { paramId: 'eq-mid-gain', minimum: -2.5, maximum: -0.5 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.4 },
                ],
            },
        ],
        prerequisites: ['The source carries content above 12 kHz rather than being a band-limited sample set.'],
        contraindications: [
            'Skip when cymbal bleed already dominates the kit balance.',
            'Skip when a bus-wide air lift is already applied downstream.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'increase' },
        ],
        source: 'Air reads as openness only when the region below it is not crowded, so the small dip near 600 Hz does as much work as the shelf above 12 kHz. A wide shelf slope keeps the lift from concentrating on one cymbal overtone.',
    },
    {
        id: 'drums-muddy',
        descriptor: 'muddy',
        roles: ['drums'],
        title: 'Clear the boxy region between the shells',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 300, maximum: 450 },
                    { paramId: 'eq-mid-gain', minimum: -5, maximum: -2 },
                    { paramId: 'eq-mid-q', minimum: 1.2, maximum: 2.5 },
                ],
            },
        ],
        prerequisites: ['The buildup is audible on the soloed kit, not only against the rest of the mix.'],
        contraindications: [
            'Skip when the kit already sounds hollow between the kick and the snare crack.',
            'Skip when the same cut is already applied on a parent bus.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'decrease' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'Drum boxiness collects between 300 Hz and 450 Hz where shell resonance and close-mic proximity overlap, and a bell narrow enough to sit between the kick fundamental and the snare body removes it without thinning either. Cutting more than 5 dB starts to hollow the kit rather than clear it.',
    },
    {
        id: 'drums-thin',
        descriptor: 'thin',
        roles: ['drums'],
        title: 'Rebuild kick weight and snare body',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 60, maximum: 100 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-mid-freq', minimum: 200, maximum: 280 },
                    { paramId: 'eq-mid-gain', minimum: 1, maximum: 2.5 },
                    { paramId: 'eq-mid-q', minimum: 0.8, maximum: 1.5 },
                ],
            },
        ],
        prerequisites: ['No steep high pass earlier in the chain is removing the content this recipe lifts.'],
        contraindications: [
            'Skip when the bass part already occupies the region below 100 Hz.',
            'Skip when the kit is deliberately filtered for a section contrast.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'rms', direction: 'increase' },
        ],
        source: 'Kick weight sits below 100 Hz and snare body around 220 Hz, and a thin kit is normally missing both rather than one. Keeping the shelf under 4 dB avoids turning weight into the low-mid buildup that the corrective recipe then has to remove.',
    },
    {
        id: 'drums-glued',
        descriptor: 'glued',
        roles: ['drums'],
        title: 'Soft-knee bus compression across the kit',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -18, maximum: -10 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 4 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 100, maximum: 250 },
                    { paramId: 'comp-knee', minimum: 6, maximum: 10 },
                ],
            },
        ],
        prerequisites: [
            'The individual drums are already balanced against each other; bus compression fixes cohesion, not balance.',
        ],
        contraindications: [
            'Skip when the kit is a single stereo loop with no internal balance to bind.',
            'Skip when downstream bus compression already reduces this material.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'Glue comes from a shared gain envelope across the whole kit, which needs a soft knee and a release long enough to span several hits rather than to track each one. A few decibels of reduction is enough; more turns cohesion into pumping.',
    },
    {
        id: 'drums-lo-fi',
        descriptor: 'lo-fi',
        roles: ['drums'],
        title: 'Sample-rate reduction into a band limit',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-bitcrusher',
                parameters: [
                    { paramId: 'crush-bits', minimum: 4, maximum: 8 },
                    { paramId: 'crush-rate', minimum: 2, maximum: 8 },
                    { paramId: 'crush-mix', minimum: 0.35, maximum: 0.6 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-filter',
                parameters: [
                    { paramId: 'filter-type', minimum: 0, maximum: 0 },
                    { paramId: 'filter-cutoff', minimum: 3000, maximum: 5000 },
                    { paramId: 'filter-resonance', minimum: 0.5, maximum: 1.5 },
                ],
            },
        ],
        prerequisites: ['The degradation is a deliberate production choice for this part or section.'],
        contraindications: [
            'Skip when the kit is the only source carrying the top of the mix.',
            'Skip when heavy downstream limiting will exaggerate the added noise floor.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Rate reduction folds content back below the audio band as inharmonic aliases, so the low pass sits after it and removes the part that reads as fizz rather than as character. A partial crush mix keeps the original transients audible under the artefacts.',
    },
    {
        id: 'drums-vintage',
        descriptor: 'vintage',
        roles: ['drums'],
        title: 'Saturated body with reduced bandwidth',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-distortion',
                parameters: [
                    { paramId: 'dist-drive', minimum: 12, maximum: 25 },
                    { paramId: 'dist-tone', minimum: 2000, maximum: 3500 },
                    { paramId: 'dist-mix', minimum: 0.3, maximum: 0.5 },
                    { paramId: 'dist-output', minimum: -8, maximum: -3 },
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
            'The level reaching the saturation stage is controlled, because drive responds to input level as much as to its own control.',
        ],
        contraindications: [
            'Skip when the kit must stay clean under a dense, modern arrangement.',
            'Skip when another harmonic stage already colours this material.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Older kit sounds come mostly from soft transient rounding plus reduced high-frequency bandwidth, so modest drive is paired with a top-end roll rather than with obvious distortion. The negative output trim keeps the added harmonics from flattering the comparison through level alone.',
    },
];
