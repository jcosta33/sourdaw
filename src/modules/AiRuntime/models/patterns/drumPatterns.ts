import { type PatternTemplate, type PatternNote, type PatternGenre } from '../MidiPatternType';

// GM drum constants
const KK = 36,
    SN = 38,
    CH = 42,
    OH = 46,
    CL = 39,
    RD = 51;

/** Drum pattern templates — varied groove styles (house, trap, breakbeat, jazz, etc.). */
export const drumPatterns: PatternTemplate[] = [
    {
        id: 'dr-4floor',
        name: '4-on-the-Floor',
        category: 'drums',
        genres: ['house', 'disco', 'edm', 'techno'],
        tags: ['dance', 'classic'],
        description: 'Standard dance beat',
        lengthBeats: 4,
        generate: (p) => {
            const notes: PatternNote[] = [];
            for (let b = 0; b < 4; b++) {
                notes.push({ pitch: KK, velocity: 100, startBeat: b, durationBeats: 0.25 });
                if (b % 2 === 1) {
                    notes.push({ pitch: CL, velocity: 95, startBeat: b, durationBeats: 0.25 });
                }
            }
            const step = p.density > 7 ? 0.25 : 0.5;
            for (let b = 0; b < 4; b += step) {
                notes.push({ pitch: CH, velocity: b % 1 === 0 ? 70 : 55, startBeat: b, durationBeats: step / 2 });
            }
            return notes;
        },
    },
    {
        id: 'dr-breakbeat',
        name: 'Breakbeat',
        category: 'drums',
        genres: ['hip-hop', 'funk', 'breakbeat' as PatternGenre],
        tags: ['funky', 'classic'],
        description: 'Classic breakbeat groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 100, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 90, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: SN, velocity: 100, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 100, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 60, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-trap',
        name: 'Trap Beat',
        category: 'drums',
        genres: ['trap', 'hip-hop'],
        tags: ['808', 'modern'],
        description: 'Trap with rapid hi-hats',
        lengthBeats: 4,
        generate: (p) => {
            const notes: PatternNote[] = [
                { pitch: KK, velocity: 110, startBeat: 0, durationBeats: 0.25 },
                { pitch: KK, velocity: 100, startBeat: 3.75, durationBeats: 0.25 },
                { pitch: CL, velocity: 100, startBeat: 1, durationBeats: 0.25 },
                { pitch: CL, velocity: 100, startBeat: 3, durationBeats: 0.25 },
            ];
            const step = p.density > 7 ? 0.125 : 0.25;
            for (let b = 0; b < 4; b += step) {
                notes.push({
                    pitch: CH,
                    velocity: 50 + Math.round(p.complexity * 4),
                    startBeat: b,
                    durationBeats: step / 2,
                });
            }
            return notes;
        },
    },
    {
        id: 'dr-jazz',
        name: 'Jazz Swing',
        category: 'drums',
        genres: ['jazz'],
        tags: ['swing', 'ride'],
        description: 'Swing ride pattern',
        lengthBeats: 4,
        generate: () => [
            { pitch: RD, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 0.67, durationBeats: 0.25 },
            { pitch: RD, velocity: 80, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 1.67, durationBeats: 0.25 },
            { pitch: RD, velocity: 80, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 2.67, durationBeats: 0.25 },
            { pitch: RD, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 3.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3, durationBeats: 0.25 },
            { pitch: KK, velocity: 70, startBeat: 0, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-bossa',
        name: 'Bossa Nova',
        category: 'drums',
        genres: ['latin', 'jazz'],
        tags: ['brazilian', 'chill'],
        description: 'Bossa nova groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 70, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: SN, velocity: 60, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 60, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 65, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 50, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-halftime',
        name: 'Half-Time',
        category: 'drums',
        genres: ['cinematic', 'ambient', 'pop'],
        tags: ['slow', 'spacious'],
        description: 'Half-time feel',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 100, startBeat: 0, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 60, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 45, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-reggae',
        name: 'Reggae One-Drop',
        category: 'drums',
        genres: ['reggae', 'world'],
        tags: ['offbeat', 'island'],
        description: 'Reggae one-drop groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 2, durationBeats: 0.25 },
            { pitch: SN, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-dnb',
        name: 'DnB Two-Step',
        category: 'drums',
        genres: ['dnb', 'edm'],
        tags: ['fast', 'energy'],
        description: 'Fast DnB two-step beat',
        lengthBeats: 4,
        generate: (p) => {
            const notes: PatternNote[] = [
                { pitch: KK, velocity: 110, startBeat: 0, durationBeats: 0.25 },
                { pitch: KK, velocity: 100, startBeat: 2.75, durationBeats: 0.25 },
                { pitch: SN, velocity: 100, startBeat: 0.5, durationBeats: 0.25 },
                { pitch: SN, velocity: 100, startBeat: 2, durationBeats: 0.25 },
            ];
            const step = p.density > 5 ? 0.25 : 0.5;
            for (let b = 0; b < 4; b += step) {
                notes.push({ pitch: CH, velocity: 75, startBeat: b, durationBeats: step / 2 });
            }
            return notes;
        },
    },
    {
        id: 'dr-metal',
        name: 'Blast Beat',
        category: 'drums',
        genres: ['metal'],
        tags: ['extreme', 'fast'],
        description: 'Extreme blast beat',
        lengthBeats: 4,
        generate: () =>
            Array.from({ length: 16 }, (_, i) => [
                { pitch: KK, velocity: 100, startBeat: i * 0.25, durationBeats: 0.125 },
                { pitch: SN, velocity: 95, startBeat: i * 0.25, durationBeats: 0.125 },
                { pitch: CH, velocity: 80, startBeat: i * 0.25, durationBeats: 0.125 },
            ]).flat(),
    },
    {
        id: 'dr-afrobeat',
        name: 'Afrobeat',
        category: 'drums',
        genres: ['afrobeat', 'world'],
        tags: ['african', 'polyrhythmic'],
        description: 'Afrobeat polyrhythmic groove',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2, durationBeats: 0.25 },
            { pitch: KK, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: SN, velocity: 90, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 75, startBeat: 3.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 0, durationBeats: 0.25 },
            { pitch: OH, velocity: 60, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 55, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: OH, velocity: 60, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 55, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-synthwave',
        name: 'Synthwave Beat',
        category: 'drums',
        genres: ['synthwave', 'pop', 'cinematic'],
        tags: ['retro', '80s'],
        description: '80s-style electronic beat',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 100, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 90, startBeat: 3, durationBeats: 0.25 },
            { pitch: CL, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: CL, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-gospel',
        name: 'Gospel Groove',
        category: 'drums',
        genres: ['gospel', 'soul', 'r&b'],
        tags: ['worship', 'ride'],
        description: 'Gospel ride pattern',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 95, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 80, startBeat: 1.75, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 0, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 1, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: RD, velocity: 70, startBeat: 3, durationBeats: 0.25 },
            { pitch: RD, velocity: 55, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-country',
        name: 'Country Train',
        category: 'drums',
        genres: ['country', 'rock'],
        tags: ['train', 'twang'],
        description: 'Country train beat',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 0.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 1.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 2.5, durationBeats: 0.25 },
            { pitch: CH, velocity: 80, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 65, startBeat: 3.5, durationBeats: 0.25 },
        ],
    },
    {
        id: 'dr-blues',
        name: 'Blues Shuffle',
        category: 'drums',
        genres: ['blues', 'rock'],
        tags: ['shuffle', 'triplet'],
        description: 'Shuffled blues beat',
        lengthBeats: 4,
        generate: () => [
            { pitch: KK, velocity: 90, startBeat: 0, durationBeats: 0.25 },
            { pitch: KK, velocity: 85, startBeat: 2, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 1, durationBeats: 0.25 },
            { pitch: SN, velocity: 95, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 0, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 0.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 1, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 1.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 2, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 2.67, durationBeats: 0.25 },
            { pitch: CH, velocity: 70, startBeat: 3, durationBeats: 0.25 },
            { pitch: CH, velocity: 50, startBeat: 3.67, durationBeats: 0.25 },
        ],
    },
];
