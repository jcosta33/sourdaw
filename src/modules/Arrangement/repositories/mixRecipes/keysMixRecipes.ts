import { type MixRecipe } from '../../models/MixRecipe';

/** Authored mixing recipes for piano, electric piano, organ, and synth keyboard parts. */
export const keysMixRecipes: readonly MixRecipe[] = [
    {
        id: 'keys-warm',
        descriptor: 'warm',
        roles: ['keys'],
        title: 'Lower-register weight with the top eased',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 150, maximum: 220 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 3.5 },
                    { paramId: 'eq-high-freq', minimum: 7000, maximum: 11000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: ['The part plays in a register that has content around 200 Hz to lift.'],
        contraindications: [
            'Skip on a part voiced low enough to collide with the bass.',
            'Skip when the keys carry the top of a dark arrangement.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'The shelf sits slightly above the usual low window because keyboard warmth lives in the left-hand register around 200 Hz rather than in the bass octave below it. Pairing the lift with a small top-end reduction makes the result read as a tilt rather than as added level.',
    },
    {
        id: 'keys-bright',
        descriptor: 'bright',
        roles: ['keys'],
        title: 'Hammer or key attack raised with the top shelf',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 2000, maximum: 3500 },
                    { paramId: 'eq-mid-gain', minimum: 1.5, maximum: 3 },
                    { paramId: 'eq-mid-q', minimum: 0.8, maximum: 1.5 },
                    { paramId: 'eq-high-freq', minimum: 8000, maximum: 12000 },
                    { paramId: 'eq-high-gain', minimum: 2, maximum: 3.5 },
                ],
            },
        ],
        prerequisites: ['The part is not already competing with the vocal in the presence region.'],
        contraindications: [
            'Skip when a lead vocal needs the same region to stay intelligible.',
            'Skip on a sampled instrument already recorded bright and close.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'increase' },
            { metric: 'frequencyBandEnergy', band: 'high-mid', direction: 'increase' },
        ],
        source: 'Key and hammer attack sits near 2.5 kHz and string or tine shimmer above 8 kHz, and a keyboard part reads bright only when both move. Keeping the bell wide raises the whole attack region rather than one note that happens to resonate there.',
    },
    {
        id: 'keys-tight',
        descriptor: 'tight',
        roles: ['keys'],
        title: 'Low shoulder trimmed under firm level control',
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
        prerequisites: ['The part is an accompaniment rather than a solo piano that needs its full low register.'],
        contraindications: [
            'Skip on a solo keyboard arrangement with no other source below 200 Hz.',
            'Skip when the performance relies on dynamic contrast between sections.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'Cutting the low shoulder before compression stops sustained left-hand notes driving gain reduction the listener attributes to the right hand. The shortened decay that follows is what reads as tightness on a sustaining keyboard part.',
    },
    {
        id: 'keys-punchy',
        descriptor: 'punchy',
        roles: ['keys'],
        title: 'Key attack through, sustain compressed',
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
        prerequisites: ['The source has genuine attack transients rather than a soft pad-style patch.'],
        contraindications: [
            'Skip on sustained pad voicings, where the attack is the least of the sound.',
            'Skip when a limiter earlier in the chain has already flattened the attacks.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'increase' },
            { metric: 'rms', direction: 'increase' },
        ],
        source: 'An attack time longer than the key strike lets the strike pass and clamps the ring behind it, so makeup gain raises the strike relative to the sustain. The result is a wider peak-to-average ratio at a higher average level, which is what punch measures as.',
    },
    {
        id: 'keys-wide',
        descriptor: 'wide',
        roles: ['keys'],
        title: 'Slow autopan across a sustaining part',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-autopan',
                parameters: [
                    { paramId: 'autopan-rate', minimum: 0.3, maximum: 1 },
                    { paramId: 'autopan-depth', minimum: 0.3, maximum: 0.6 },
                    { paramId: 'autopan-shape', minimum: 0, maximum: 0 },
                ],
            },
        ],
        prerequisites: [
            'The part sustains long enough for movement below 1 Hz to be perceived as image rather than as tremolo.',
        ],
        contraindications: [
            'Skip on a rhythmic comping part, where movement fights the groove instead of supporting it.',
            'Skip when the mix will be judged primarily in mono, where the pan collapses to level modulation.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'increase' },
            { metric: 'stereoCorrelation', direction: 'decrease' },
        ],
        source: 'Below about 1 Hz a sine pan reads as the part occupying space rather than as an effect, which is why the rate stops there. Partial depth keeps the part from reaching either speaker fully and leaving a hole in the middle of the image.',
    },
    {
        id: 'keys-intimate',
        descriptor: 'intimate',
        roles: ['keys'],
        title: 'Small short ambience with the tail filtered',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-reverb',
                parameters: [
                    { paramId: 'rev-size', minimum: 0.25, maximum: 0.4 },
                    { paramId: 'rev-decay', minimum: 0.8, maximum: 1.5 },
                    { paramId: 'rev-predelay', minimum: 20, maximum: 40 },
                    { paramId: 'rev-mix', minimum: 0.1, maximum: 0.2 },
                    { paramId: 'rev-damping', minimum: 0.5, maximum: 0.8 },
                    { paramId: 'rev-lowcut', minimum: 200, maximum: 400 },
                ],
            },
        ],
        prerequisites: ['The source is dry, or its own sampled ambience is short enough not to stack with this one.'],
        contraindications: [
            'Skip on a sampled instrument that already carries a recorded hall.',
            'Skip when the part plays fast figures that any tail would blur.',
        ],
        metrics: [
            { metric: 'rms', direction: 'increase' },
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
        ],
        source: 'A short decay with high damping and a low cut above 200 Hz gives context without either thickening the left hand or extending the tail into the next chord. Pre-delay near 30 ms keeps the direct sound separate, which is what stops the part receding.',
    },
    {
        id: 'keys-dark',
        descriptor: 'dark',
        roles: ['keys'],
        title: 'Attack region and top shelf reduced',
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
        prerequisites: ['The part remains articulate after the cut; removing attack detail costs rhythmic clarity.'],
        contraindications: [
            'Skip when the keys already sit behind the arrangement.',
            'Skip on a patch already voiced dark, where the cut only removes level.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'presence', direction: 'decrease' },
        ],
        source: 'Shelving alone leaves the key attack forward and the part still reads bright, so the bell near 3 kHz comes down with it. Both stay under 6 dB so the part recedes in character rather than simply in level.',
    },
    {
        id: 'keys-airy',
        descriptor: 'airy',
        roles: ['keys'],
        title: 'Wide shelf above the harmonic region',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 11000, maximum: 14000 },
                    { paramId: 'eq-high-gain', minimum: 2, maximum: 3.5 },
                    { paramId: 'eq-high-q', minimum: 0.5, maximum: 0.8 },
                ],
            },
        ],
        prerequisites: ['The patch or sample set carries content above 11 kHz.'],
        contraindications: [
            'Skip on a band-limited sample library, where the shelf lifts only the noise floor.',
            'Skip when a bus-wide air lift is already applied downstream.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'increase' },
        ],
        source: 'Placing the shelf above 11 kHz keeps it clear of the attack region, so the part gains openness without also gaining forwardness. A wide slope avoids concentrating the lift on a single sampled overtone.',
    },
    {
        id: 'keys-muddy',
        descriptor: 'muddy',
        roles: ['keys'],
        title: 'Clear the crowded left-hand region',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 250, maximum: 450 },
                    { paramId: 'eq-mid-gain', minimum: -5, maximum: -2 },
                    { paramId: 'eq-mid-q', minimum: 1.2, maximum: 2.5 },
                ],
            },
        ],
        prerequisites: ['The buildup is audible on the soloed part rather than only in the full arrangement.'],
        contraindications: [
            'Skip when the part already sounds hollow on its own.',
            'Skip when a parent bus already carries the same corrective cut.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'decrease' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'Dense left-hand voicings pile several notes into the 250 Hz to 450 Hz region, below the mid band the descriptor usually reaches, and that is also where bass harmonics and vocal body sit. A bell narrow enough to sit between those voicings clears the collision without hollowing the part.',
    },
    {
        id: 'keys-thin',
        descriptor: 'thin',
        roles: ['keys'],
        title: 'Restore left-hand weight and fill',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 120, maximum: 200 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-mid-freq', minimum: 300, maximum: 500 },
                    { paramId: 'eq-mid-gain', minimum: 1, maximum: 2.5 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: ['No steep high pass earlier in the chain is removing the register this recipe rebuilds.'],
        contraindications: [
            'Skip when the bass and the left hand already occupy the same octave.',
            'Skip on a part deliberately filtered for section contrast.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'A thin keyboard part is normally missing both the left-hand fundamental region and the fill just above it, so a shelf and a broad bell are used together. Each stays under 4 dB to avoid crossing into the buildup the corrective recipe removes.',
    },
    {
        id: 'keys-glued',
        descriptor: 'glued',
        roles: ['keys'],
        title: 'Soft-knee compression across the performance',
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
            'An earlier stage already controls peaks, so this stage can stay under a few decibels of reduction.',
        ],
        contraindications: [
            'Skip when no earlier stage controls peaks; this one alone will chase them and pump.',
            'Skip on a fixed-velocity programmed part with nothing to settle.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'A release spanning several chords produces the slow shared envelope that reads as cohesion, where a release tracking each chord would read as pumping. The soft knee keeps the onset of reduction from marking individual notes.',
    },
    {
        id: 'keys-lo-fi',
        descriptor: 'lo-fi',
        roles: ['keys'],
        title: 'Quantisation grit under a band limit',
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
            'Skip when the part carries the harmonic content the arrangement depends on.',
            'Skip when downstream limiting would raise the added noise floor between chords.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Rate reduction folds inharmonic aliases down into the audio band, and on a sustaining chordal part those aliases beat against the held notes, so the low pass follows the crusher rather than preceding it. A partial mix keeps the voicing legible under the grit.',
    },
    {
        id: 'keys-vintage',
        descriptor: 'vintage',
        roles: ['keys'],
        title: 'Amplitude modulation under a reduced bandwidth',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-tremolo',
                parameters: [
                    { paramId: 'trem-rate', minimum: 4, maximum: 6 },
                    { paramId: 'trem-depth', minimum: 0.25, maximum: 0.5 },
                    { paramId: 'trem-shape', minimum: 0, maximum: 0 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 7000, maximum: 11000 },
                    { paramId: 'eq-high-gain', minimum: -4, maximum: -1.5 },
                ],
            },
        ],
        prerequisites: ['The part sustains; amplitude modulation is inaudible on short staccato figures.'],
        contraindications: [
            'Skip when the modulation rate beats against the tempo and reads as a rhythmic error.',
            'Skip when the arrangement needs a modern, unmodulated keyboard sound.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
            { metric: 'spectralRolloff', direction: 'decrease' },
        ],
        source: 'Period keyboard amplifiers modulated amplitude at a few hertz with a sine shape and stopped well short of the top octave, so the modulation and the bandwidth limit belong together. Depth under a half keeps the effect as character rather than as a gate.',
    },
];
