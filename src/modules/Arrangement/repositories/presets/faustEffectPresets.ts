import { type SoundPreset, type DevicePreset } from '../../models/SoundPreset';

const AUTHOR = 'Sourdaw';

function faustEffect(type: string, name: string, params: Record<string, number>): DevicePreset {
    return { type, name, parameterValues: params };
}

export const FAUST_EFFECT_PRESETS: SoundPreset[] = [
    // ─── 1176 Compressor ──────────────────────────────────────────────────
    {
        id: 'factory-faust-1176-drum-smash',
        name: 'Drum Bus Smash',
        category: 'fx',
        subcategory: 'dynamics',
        description: 'Aggressive 1176 compression for drum buses. Fast attack, fast release.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-1176-compressor', 'Drum Smash', {
                ratio: 20,
                threshold: -30,
                attack: 0.001,
                release: 0.05,
            }),
        ],
        tags: ['compressor', 'drums', 'smash', 'aggressive'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-faust-1176-vocal-control',
        name: 'Vocal Control',
        category: 'fx',
        subcategory: 'dynamics',
        description: 'Smooth 4:1 compression to control vocal dynamics.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-1176-compressor', 'Vocal Control', {
                ratio: 4,
                threshold: -24,
                attack: 0.01,
                release: 0.15,
            }),
        ],
        tags: ['compressor', 'vocal', 'smooth'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-faust-1176-gentle-glue',
        name: 'Gentle Glue',
        category: 'fx',
        subcategory: 'dynamics',
        description: 'Low ratio, slow attack glue for the mix bus.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-1176-compressor', 'Gentle Glue', {
                ratio: 2,
                threshold: -18,
                attack: 0.03,
                release: 0.3,
            }),
        ],
        tags: ['compressor', 'bus', 'glue'],
        author: AUTHOR,
        isFactory: true,
    },

    // ─── Zita-Rev1 Reverb ──────────────────────────────────────────────────
    {
        id: 'factory-faust-zita-huge-hall',
        name: 'Huge Hall',
        category: 'fx',
        subcategory: 'reverb',
        description: 'A massive, lush hall reverb using Zita-Rev1.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-zita-rev1-reverb', 'Huge Hall', {
                decay_time: 6.0,
                damping: 4000,
                dry_wet: 0.4,
            }),
        ],
        tags: ['reverb', 'hall', 'huge', 'lush'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-faust-zita-vocal-plate',
        name: 'Vocal Plate',
        category: 'fx',
        subcategory: 'reverb',
        description: 'A bright, medium-decay plate suitable for vocals.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-zita-rev1-reverb', 'Vocal Plate', {
                decay_time: 2.5,
                damping: 8000,
                dry_wet: 0.25,
            }),
        ],
        tags: ['reverb', 'plate', 'vocal'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-faust-zita-tight-room',
        name: 'Tight Room',
        category: 'fx',
        subcategory: 'reverb',
        description: 'A short decay room reverb for drums and percussion.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-zita-rev1-reverb', 'Tight Room', {
                decay_time: 0.8,
                damping: 10000,
                dry_wet: 0.2,
            }),
        ],
        tags: ['reverb', 'room', 'tight', 'drums'],
        author: AUTHOR,
        isFactory: true,
    },

    // ─── Tape Delay ──────────────────────────────────────────────────
    {
        id: 'factory-faust-tape-slapback',
        name: 'Slapback Delay',
        category: 'fx',
        subcategory: 'delay',
        description: 'Classic short slapback echo for vocals or guitars.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-tape-delay', 'Slapback', {
                delay: 0.08,
                feedback: 0.1,
                dry_wet: 0.3,
            }),
        ],
        tags: ['delay', 'slapback', 'tape', 'vintage'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-faust-tape-space-echo',
        name: 'Space Echo',
        category: 'fx',
        subcategory: 'delay',
        description: 'Long, highly-feedbacking tape delay with wow and flutter.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-tape-delay', 'Space Echo', {
                delay: 0.5,
                feedback: 0.85,
                wow_flutter: 0.6,
                tone: 2500,
                dry_wet: 0.4,
            }),
        ],
        tags: ['delay', 'space', 'echo', 'dub'],
        author: AUTHOR,
        isFactory: true,
    },
    {
        id: 'factory-faust-tape-dub-delay',
        name: 'Dub Delay',
        category: 'fx',
        subcategory: 'delay',
        description: 'Dark, rhythmic delay for dub and reggae.',
        trackKind: 'audio',
        devices: [
            faustEffect('faust-tape-delay', 'Dub Delay', {
                delay: 0.375, // Assuming tempo-synced or roughly dotted 8th at 120bpm
                feedback: 0.7,
                wow_flutter: 0.3,
                tone: 1500,
                dry_wet: 0.5,
            }),
        ],
        tags: ['delay', 'dub', 'dark'],
        author: AUTHOR,
        isFactory: true,
    },
];
