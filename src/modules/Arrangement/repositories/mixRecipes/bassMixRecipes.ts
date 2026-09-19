import { type MixRecipe } from '../../models/MixRecipe';

/** Authored mixing recipes for bass guitar, synth bass, and sub parts. */
export const bassMixRecipes: readonly MixRecipe[] = [
    {
        id: 'bass-warm',
        descriptor: 'warm',
        roles: ['bass'],
        title: 'Fundamental weight with string noise eased',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 70, maximum: 110 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-high-freq', minimum: 6000, maximum: 9000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: ['The monitoring path reproduces below 100 Hz, or the lift cannot be judged.'],
        contraindications: [
            'Skip when the kick already owns the region below 100 Hz.',
            'Skip when the bass line must stay audible on small speakers through its harmonics alone.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'spectralCentroid', direction: 'decrease' },
        ],
        source: 'The fundamental of most played bass notes falls between 70 Hz and 110 Hz, so a shelf there adds weight rather than sub rumble. Easing the string and fret noise above 6 kHz tilts the balance downward without dulling the note definition in the mids.',
    },
    {
        id: 'bass-bright',
        descriptor: 'bright',
        roles: ['bass'],
        title: 'Note definition raised in the harmonic region',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 700, maximum: 1200 },
                    { paramId: 'eq-mid-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-mid-q', minimum: 0.8, maximum: 1.5 },
                    { paramId: 'eq-high-freq', minimum: 3000, maximum: 5000 },
                    { paramId: 'eq-high-gain', minimum: 1, maximum: 3 },
                ],
            },
        ],
        prerequisites: [
            'The performance has pick or finger attack to expose; a pure sine sub has no harmonics to raise.',
        ],
        contraindications: [
            'Skip when fret and string noise is already intrusive.',
            'Skip when guitars already occupy the region between 700 Hz and 1.2 kHz.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'increase' },
            { metric: 'frequencyBandEnergy', band: 'mid', direction: 'increase' },
        ],
        source: 'A bass reads as bright through its second and third harmonics rather than through its fundamental, which is why the work happens near 1 kHz and again at the attack region above 3 kHz. This also keeps the part audible on playback systems that cannot reproduce the fundamental at all.',
    },
    {
        id: 'bass-tight',
        descriptor: 'tight',
        roles: ['bass'],
        title: 'Sub-rumble removed under firm level control',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-filter',
                parameters: [
                    { paramId: 'filter-type', minimum: 1, maximum: 1 },
                    { paramId: 'filter-cutoff', minimum: 30, maximum: 50 },
                    { paramId: 'filter-resonance', minimum: 0.5, maximum: 1 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -24, maximum: -16 },
                    { paramId: 'comp-ratio', minimum: 4, maximum: 6 },
                    { paramId: 'comp-attack', minimum: 8, maximum: 20 },
                    { paramId: 'comp-release', minimum: 80, maximum: 160 },
                    { paramId: 'comp-makeup', minimum: 2, maximum: 6 },
                ],
            },
        ],
        prerequisites: [
            'The part is a played bass rather than a deliberate sub-bass line whose content lies below 40 Hz.',
        ],
        contraindications: [
            'Skip on sub-bass parts whose musical content sits under the cutoff.',
            'Skip when a release under 160 ms would modulate the lowest notes within one cycle.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'sub', direction: 'decrease' },
        ],
        source: 'The high pass sits below the typical filter window on purpose: at 30 Hz to 50 Hz it removes handling and cabinet rumble that eats headroom while leaving every played fundamental intact. Filtering before compression stops that rumble triggering gain reduction the listener never hears.',
    },
    {
        id: 'bass-punchy',
        descriptor: 'punchy',
        roles: ['bass'],
        title: 'Level held steady, then ducked under the kick',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -20, maximum: -12 },
                    { paramId: 'comp-ratio', minimum: 3, maximum: 5 },
                    { paramId: 'comp-attack', minimum: 15, maximum: 30 },
                    { paramId: 'comp-release', minimum: 60, maximum: 120 },
                    { paramId: 'comp-makeup', minimum: 2, maximum: 5 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-sidechain-compressor',
                parameters: [
                    { paramId: 'sc-comp-threshold', minimum: -26, maximum: -14 },
                    { paramId: 'sc-comp-ratio', minimum: 3, maximum: 6 },
                    { paramId: 'sc-comp-attack', minimum: 3, maximum: 10 },
                    { paramId: 'sc-comp-release', minimum: 80, maximum: 200 },
                ],
            },
        ],
        prerequisites: ['A kick or drum source is routed to the sidechain input of the second stage.'],
        contraindications: [
            'Skip when no kick shares the low register with this part; the duck then has nothing to make room for.',
            'Skip when the release cannot recover before the next kick at this tempo.',
        ],
        metrics: [
            { metric: 'transientDensity', direction: 'hold' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'Punch in the low end is mostly a question of who occupies the first fifty milliseconds after each kick, so the first stage steadies the bass level and the second clears that window. A release tied to the gap between kicks restores the bass fully before the next note rather than pumping across the bar.',
    },
    {
        id: 'bass-wide',
        descriptor: 'wide',
        roles: ['bass'],
        title: 'Harmonics spread above a summed low end',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-stereo-widener',
                parameters: [
                    { paramId: 'width-amount', minimum: 1.1, maximum: 1.35 },
                    { paramId: 'width-mono-bass', minimum: 120, maximum: 200 },
                    { paramId: 'width-side', minimum: 0, maximum: 2 },
                ],
            },
        ],
        prerequisites: ['The source is stereo, such as a layered synth bass or a doubled amp and direct pair.'],
        contraindications: [
            'Skip on a mono bass part, where widening produces phase differences rather than image.',
            'Skip when the release target includes vinyl cutting or other mono-summed low-end delivery.',
        ],
        metrics: [
            { metric: 'sideEnergyFraction', direction: 'increase' },
            { metric: 'lowFrequencyStereoContent', direction: 'hold' },
        ],
        source: 'Only the harmonic content above the mono crossover can be widened safely, because decorrelating the fundamental costs level on mono fold-down and destabilises the low end. A crossover at 120 Hz to 200 Hz keeps every fundamental centred while the upper harmonics carry the image.',
    },
    {
        id: 'bass-intimate',
        descriptor: 'intimate',
        roles: ['bass'],
        title: 'Steady close level with the top eased back',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -22, maximum: -14 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 3 },
                    { paramId: 'comp-attack', minimum: 15, maximum: 30 },
                    { paramId: 'comp-release', minimum: 120, maximum: 250 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 4000, maximum: 7000 },
                    { paramId: 'eq-high-gain', minimum: -3, maximum: -1 },
                ],
            },
        ],
        prerequisites: [
            'The part is played rather than programmed at a fixed velocity; there are note-to-note differences to even out.',
        ],
        contraindications: [
            'Skip when the arrangement depends on the bass swelling and receding between sections.',
            'Skip on a source already level-ridden at the recording stage.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'rms', direction: 'increase' },
        ],
        source: 'A bass sounds close when every note arrives at the same level, so a low ratio with a long release does the work rather than any spatial device. Easing the string noise above 4 kHz removes the sense of distance that bright attack detail gives.',
    },
    {
        id: 'bass-dark',
        descriptor: 'dark',
        roles: ['bass'],
        title: 'Harmonic top removed above the note region',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 3000, maximum: 6000 },
                    { paramId: 'eq-high-gain', minimum: -8, maximum: -4 },
                    { paramId: 'eq-mid-freq', minimum: 800, maximum: 1500 },
                    { paramId: 'eq-mid-gain', minimum: -3, maximum: -1 },
                    { paramId: 'eq-mid-q', minimum: 0.8, maximum: 1.5 },
                ],
            },
        ],
        prerequisites: [
            'The bass line stays audible on small speakers after the cut, which depends on the harmonics that remain.',
        ],
        contraindications: [
            'Skip when the part must carry the harmony on playback systems with no low-frequency reproduction.',
            'Skip when a low-pass filter is already applied earlier in the chain.',
        ],
        metrics: [
            { metric: 'spectralCentroid', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'high-mid', direction: 'decrease' },
        ],
        source: 'A dark bass is defined by the absence of pick and fret detail above 3 kHz plus a reduced second-harmonic region near 1 kHz, and removing only one of the two leaves the part still reading forward. The cuts stop short of removing the harmonics small speakers need to imply the note at all.',
    },
    {
        id: 'bass-airy',
        descriptor: 'airy',
        roles: ['bass'],
        title: 'String and fret detail brought up gently',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 6000, maximum: 10000 },
                    { paramId: 'eq-high-gain', minimum: 1.5, maximum: 3 },
                    { paramId: 'eq-high-q', minimum: 0.5, maximum: 1 },
                ],
            },
        ],
        prerequisites: [
            'The source has genuine high-frequency content rather than a synthesised waveform with no energy above 6 kHz.',
        ],
        contraindications: [
            'Skip when finger and fret noise already draws attention away from the notes.',
            'Skip when an amp simulation has already been chosen for its rolled-off character.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'increase' },
            { metric: 'spectralRolloff', direction: 'increase' },
        ],
        source: 'Air on a bass is the physical noise of the player rather than tone, so the lift stays under 3 dB and sits above the harmonic region where definition already lives. Any more turns performance detail into a separate, distracting layer.',
    },
    {
        id: 'bass-muddy',
        descriptor: 'muddy',
        roles: ['bass'],
        title: 'Cut the shoulder above the fundamental',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-mid-freq', minimum: 200, maximum: 350 },
                    { paramId: 'eq-mid-gain', minimum: -5, maximum: -2 },
                    { paramId: 'eq-mid-q', minimum: 1.2, maximum: 2.5 },
                ],
            },
        ],
        prerequisites: ['The buildup is audible on the soloed bass rather than only in the full arrangement.'],
        contraindications: [
            'Skip when the bass already sounds hollow; the buildup then belongs to guitars or keys.',
            'Skip when the same region is already cut on a parent bus.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'low-mid', direction: 'decrease' },
            { metric: 'interTrackMasking', direction: 'decrease' },
        ],
        source: 'Bass mud collects just above the fundamental, between 200 Hz and 350 Hz, where cabinet resonance and room modes pile up and where vocals and guitars also sit. A narrow bell there clears space for those sources while leaving the fundamental octave and the definition region untouched.',
    },
    {
        id: 'bass-thin',
        descriptor: 'thin',
        roles: ['bass'],
        title: 'Rebuild the fundamental octave',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-low-freq', minimum: 50, maximum: 90 },
                    { paramId: 'eq-low-gain', minimum: 2, maximum: 4 },
                    { paramId: 'eq-mid-freq', minimum: 200, maximum: 300 },
                    { paramId: 'eq-mid-gain', minimum: 1, maximum: 2.5 },
                    { paramId: 'eq-mid-q', minimum: 0.7, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: ['No high pass earlier in the chain is removing the octave this recipe rebuilds.'],
        contraindications: [
            'Skip when the kick already fills the region below 90 Hz.',
            'Skip when downstream limiting is already working hard, because low-end lift costs the most headroom.',
        ],
        metrics: [
            { metric: 'frequencyBandEnergy', band: 'bass', direction: 'increase' },
            { metric: 'busHeadroom', direction: 'decrease' },
        ],
        source: 'A thin bass is normally missing the fundamental rather than the body, so the shelf sits in the played octave and the broad bell above it restores the weight that follows. Both moves consume headroom quickly, which is why each stays under 4 dB.',
    },
    {
        id: 'bass-glued',
        descriptor: 'glued',
        roles: ['bass'],
        title: 'Long-release compression for a constant floor',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-compressor',
                parameters: [
                    { paramId: 'comp-threshold', minimum: -18, maximum: -10 },
                    { paramId: 'comp-ratio', minimum: 2, maximum: 4 },
                    { paramId: 'comp-attack', minimum: 20, maximum: 30 },
                    { paramId: 'comp-release', minimum: 150, maximum: 250 },
                    { paramId: 'comp-knee', minimum: 6, maximum: 10 },
                ],
            },
        ],
        prerequisites: ['A peak-controlling stage already sits earlier in the chain, so this stage can stay gentle.'],
        contraindications: [
            'Skip when a release shorter than the lowest note period would modulate that note.',
            'Skip when the part is already a constant-level synth bass with nothing to settle.',
        ],
        metrics: [
            { metric: 'dynamicRangeEstimate', direction: 'decrease' },
            { metric: 'crestFactor', direction: 'decrease' },
        ],
        source: 'A bass glues to a track by holding a constant floor under it, which needs a release long enough to span several notes rather than to track each one. A release shorter than one cycle of the lowest note would modulate that note as distortion instead.',
    },
    {
        id: 'bass-lo-fi',
        descriptor: 'lo-fi',
        roles: ['bass'],
        title: 'Quantisation grit under a narrow band limit',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-bitcrusher',
                parameters: [
                    { paramId: 'crush-bits', minimum: 4, maximum: 8 },
                    { paramId: 'crush-rate', minimum: 2, maximum: 8 },
                    { paramId: 'crush-mix', minimum: 0.25, maximum: 0.5 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-filter',
                parameters: [
                    { paramId: 'filter-type', minimum: 0, maximum: 0 },
                    { paramId: 'filter-cutoff', minimum: 1500, maximum: 3000 },
                    { paramId: 'filter-resonance', minimum: 0.5, maximum: 1.2 },
                ],
            },
        ],
        prerequisites: ['The degraded character is a deliberate production choice for this part or section.'],
        contraindications: [
            'Skip when the bass must stay clean to anchor the low end of the mix.',
            'Skip when downstream limiting will pull the added quantisation noise up between notes.',
        ],
        metrics: [
            { metric: 'spectralRolloff', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'high-mid', direction: 'decrease' },
        ],
        source: 'Bit reduction on a low-frequency source produces noise that sits across the whole spectrum rather than only near the notes, so the low pass follows it and keeps the grit inside the bass register. A crush mix under a half keeps the original fundamental intact underneath.',
    },
    {
        id: 'bass-vintage',
        descriptor: 'vintage',
        roles: ['bass'],
        title: 'Harmonic drive with the top rolled away',
        steps: [
            {
                kind: 'insert',
                deviceType: 'builtin-distortion',
                parameters: [
                    { paramId: 'dist-drive', minimum: 10, maximum: 22 },
                    { paramId: 'dist-tone', minimum: 1500, maximum: 3000 },
                    { paramId: 'dist-mix', minimum: 0.3, maximum: 0.5 },
                    { paramId: 'dist-output', minimum: -8, maximum: -3 },
                ],
            },
            {
                kind: 'insert',
                deviceType: 'builtin-eq',
                parameters: [
                    { paramId: 'eq-high-freq', minimum: 5000, maximum: 9000 },
                    { paramId: 'eq-high-gain', minimum: -4, maximum: -1.5 },
                ],
            },
        ],
        prerequisites: [
            'Level into the drive stage is already controlled, because drive responds to input level as much as to its own control.',
        ],
        contraindications: [
            'Skip when the track needs a clean, wide-bandwidth low end.',
            'Skip when another saturation stage already colours this part.',
        ],
        metrics: [
            { metric: 'crestFactor', direction: 'decrease' },
            { metric: 'frequencyBandEnergy', band: 'air', direction: 'decrease' },
        ],
        source: 'Older bass recordings read as vintage through added low-order harmonics and a bandwidth that stops well short of the top octave, so a small amount of drive is paired with a shelf rather than pushed hard on its own. Partial mix keeps the dry fundamental underneath the harmonics the drive adds.',
    },
];
