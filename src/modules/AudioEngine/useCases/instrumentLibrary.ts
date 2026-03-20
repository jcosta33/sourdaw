/**
 * Instrument Library.
 * Defines available instrument presets and their sample/Faust sources.
 * Provides metadata for the sidebar browser and tiered delivery.
 */

export type InstrumentDefinition = {
    id: string;
    name: string;
    category: InstrumentCategory;
    source: 'sfz' | 'sf2' | 'faust' | 'web-audio';
    tier: 'bundled' | 'first-run' | 'on-demand' | 'premium';
    sizeBytes: number;
    description: string;
    tags: string[];
    sampleUrl?: string;
    faustModuleId?: string;
};

export type InstrumentCategory =
    | 'piano'
    | 'keys'
    | 'strings'
    | 'brass'
    | 'woodwinds'
    | 'drums'
    | 'synth'
    | 'bass'
    | 'guitar'
    | 'organ'
    | 'world'
    | 'sfx';

export const INSTRUMENT_LIBRARY: InstrumentDefinition[] = [
    // ─── Bundled (~50 MB core) ─────────────────────
    {
        id: 'piano-salamander',
        name: 'Salamander Grand Piano',
        category: 'piano',
        source: 'sfz',
        tier: 'bundled',
        sizeBytes: 24_500_000,
        description: 'Yamaha C5 grand piano, 16 velocity layers, CC-BY',
        tags: ['piano', 'grand', 'acoustic', 'classical'],
        sampleUrl: '/instruments/salamander-grand/',
    },
    {
        id: 'rhodes-faust',
        name: 'Rhodes Electric Piano',
        category: 'keys',
        source: 'faust',
        tier: 'bundled',
        sizeBytes: 0,
        description: 'Rhodes Mark II synthesis with tine/bark modeling',
        tags: ['electric-piano', 'rhodes', 'keys', 'jazz'],
        faustModuleId: 'faust-fm-synth',
    },
    {
        id: 'hammond-faust',
        name: 'Hammond B3 Organ',
        category: 'organ',
        source: 'faust',
        tier: 'bundled',
        sizeBytes: 0,
        description: 'Tonewheel organ with drawbars and Leslie sim',
        tags: ['organ', 'hammond', 'leslie', 'keys'],
        faustModuleId: 'faust-additive-synth',
    },
    {
        id: 'drums-808',
        name: '808 Electronic Drums',
        category: 'drums',
        source: 'faust',
        tier: 'bundled',
        sizeBytes: 0,
        description: 'Roland TR-808 style drum synthesis',
        tags: ['drums', '808', 'electronic', 'hip-hop'],
        faustModuleId: 'faust-808-drums',
    },
    {
        id: 'drums-909',
        name: '909 Electronic Drums',
        category: 'drums',
        source: 'faust',
        tier: 'bundled',
        sizeBytes: 0,
        description: 'Roland TR-909 style drum synthesis',
        tags: ['drums', '909', 'electronic', 'house'],
        faustModuleId: 'faust-909-drums',
    },
    {
        id: 'drums-acoustic',
        name: 'Virtuosity Acoustic Drums',
        category: 'drums',
        source: 'sfz',
        tier: 'bundled',
        sizeBytes: 12_000_000,
        description: 'Multi-velocity acoustic drum kit, CC0',
        tags: ['drums', 'acoustic', 'rock', 'pop'],
        sampleUrl: '/instruments/virtuosity-drums/',
    },
    {
        id: 'bass-sub',
        name: 'Sub Bass',
        category: 'bass',
        source: 'web-audio',
        tier: 'bundled',
        sizeBytes: 0,
        description: 'Pure sine/triangle sub bass synthesizer',
        tags: ['bass', 'sub', 'electronic'],
    },

    // ─── First-run download ────────────────────────
    {
        id: 'strings-vsco',
        name: 'VSCO 2 Strings',
        category: 'strings',
        source: 'sfz',
        tier: 'first-run',
        sizeBytes: 450_000_000,
        description: 'Violin, viola, cello, bass sections. CC0',
        tags: ['strings', 'orchestral', 'classical', 'film'],
        sampleUrl: '/instruments/vsco2/strings/',
    },
    {
        id: 'brass-vsco',
        name: 'VSCO 2 Brass',
        category: 'brass',
        source: 'sfz',
        tier: 'first-run',
        sizeBytes: 350_000_000,
        description: 'Trumpet, french horn, trombone, tuba. CC0',
        tags: ['brass', 'orchestral', 'classical', 'film'],
        sampleUrl: '/instruments/vsco2/brass/',
    },
    {
        id: 'woodwinds-vsco',
        name: 'VSCO 2 Woodwinds',
        category: 'woodwinds',
        source: 'sfz',
        tier: 'first-run',
        sizeBytes: 300_000_000,
        description: 'Flute, clarinet, oboe, bassoon. CC0',
        tags: ['woodwinds', 'orchestral', 'classical', 'film'],
        sampleUrl: '/instruments/vsco2/woodwinds/',
    },

    // ─── On-demand ─────────────────────────────────
    {
        id: 'fm-synth',
        name: 'FM Synthesizer',
        category: 'synth',
        source: 'faust',
        tier: 'on-demand',
        sizeBytes: 0,
        description: 'DX7-style 6-operator FM synthesis',
        tags: ['synth', 'fm', 'digital', 'dx7'],
        faustModuleId: 'faust-fm-synth',
    },
    {
        id: 'wavetable-synth',
        name: 'Wavetable Synthesizer',
        category: 'synth',
        source: 'faust',
        tier: 'on-demand',
        sizeBytes: 0,
        description: 'Wavetable synth with morphing and unison',
        tags: ['synth', 'wavetable', 'modern'],
        faustModuleId: 'faust-wavetable-synth',
    },
    {
        id: 'granular-synth',
        name: 'Granular Synthesizer',
        category: 'synth',
        source: 'faust',
        tier: 'on-demand',
        sizeBytes: 0,
        description: 'Granular synthesis engine',
        tags: ['synth', 'granular', 'texture', 'ambient'],
        faustModuleId: 'faust-granular-synth',
    },
    {
        id: 'physical-model',
        name: 'Physical Model Strings',
        category: 'strings',
        source: 'faust',
        tier: 'on-demand',
        sizeBytes: 0,
        description: 'Karplus-Strong string synthesis',
        tags: ['synth', 'physical-model', 'strings', 'pluck'],
        faustModuleId: 'faust-physical-model-string',
    },
];

/**
 * Get instruments by category.
 */
export function getInstrumentsByCategory(category: InstrumentCategory): InstrumentDefinition[] {
    return INSTRUMENT_LIBRARY.filter((i) => i.category === category);
}

/**
 * Get instruments by tier.
 */
export function getInstrumentsByTier(tier: InstrumentDefinition['tier']): InstrumentDefinition[] {
    return INSTRUMENT_LIBRARY.filter((i) => i.tier === tier);
}

/**
 * Get bundled instruments (included in base install).
 */
export function getBundledInstruments(): InstrumentDefinition[] {
    return getInstrumentsByTier('bundled');
}

/**
 * Calculate total download size for a tier.
 */
export function getTierSize(tier: InstrumentDefinition['tier']): number {
    return getInstrumentsByTier(tier).reduce((sum, i) => sum + i.sizeBytes, 0);
}

/**
 * Search instruments by tag or name.
 */
export function searchInstruments(query: string): InstrumentDefinition[] {
    const q = query.toLowerCase();
    return INSTRUMENT_LIBRARY.filter(
        (i) =>
            i.name.toLowerCase().includes(q) ||
            i.description.toLowerCase().includes(q) ||
            i.tags.some((t) => t.includes(q))
    );
}
