import { type PatternTemplate, type PatternNote, getScalePitches, snapToScale, chordFromDegrees } from '../midiPatternLibrary';

/** Chord pattern templates — triad and extended chord progressions across multiple genres. */
export const chordPatterns: PatternTemplate[] = [
    {
        id: 'ch-1564',
        name: 'I–V–vi–IV (Pop)',
        category: 'chords',
        genres: ['pop', 'rock'],
        tags: ['anthem', 'common'],
        description: 'The most common pop progression',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            const d = p.density > 5 ? 2 : 4;
            const beats = Array.from({ length: 16 / d }, (_, i) => i * d);
            const degs = [
                [0, 2, 4],
                [4, 6, 8],
                [5, 7, 9],
                [3, 5, 7],
            ];
            return beats.flatMap((b, i) =>
                chordFromDegrees(
                    p.complexity > 5 ? [...degs[i % 4]!, degs[i % 4]![0]! + 7] : degs[i % 4]!,
                    sp,
                    o,
                    b,
                    d,
                    75 + p.density * 2
                )
            );
        },
    },
    {
        id: 'ch-251',
        name: 'ii–V–I (Jazz)',
        category: 'chords',
        genres: ['jazz', 'lo-fi', 'soul'],
        tags: ['classic', 'smooth'],
        description: 'Classic jazz cadence',
        lengthBeats: 12,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            return [
                [1, 3, 5, 7],
                [4, 6, 8, 10],
                [0, 2, 4, 6],
            ].flatMap((deg, i) =>
                chordFromDegrees(p.complexity > 5 ? deg : deg.slice(0, 3), sp, o, i * 4, 4, 72 + p.density * 2)
            );
        },
    },
    {
        id: 'ch-minor145',
        name: 'i–iv–v (Minor)',
        category: 'chords',
        genres: ['rock', 'pop', 'metal'],
        tags: ['dark', 'moody'],
        description: 'Classic minor progression',
        lengthBeats: 12,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale === 'major' ? 'minor' : p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(57, sp)) - 0);
            return [
                [0, 2, 4],
                [3, 5, 7],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 78));
        },
    },
    {
        id: 'ch-blues12',
        name: '12-Bar Blues',
        category: 'chords',
        genres: ['blues', 'rock', 'jazz'],
        tags: ['classic', 'shuffle'],
        description: '12-bar blues form',
        lengthBeats: 48,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'blues', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            const pat = [0, 0, 0, 0, 3, 3, 0, 0, 4, 3, 0, 4];
            return pat.flatMap((root, i) => chordFromDegrees([root, root + 2, root + 4], sp, o, i * 4, 4, 78));
        },
    },
    {
        id: 'ch-sad',
        name: 'vi–IV–I–V (Sad)',
        category: 'chords',
        genres: ['pop', 'r&b', 'soul'],
        tags: ['ballad', 'emotional'],
        description: 'Emotional descending progression',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            return [
                [5, 7, 9],
                [3, 5, 7],
                [0, 2, 4],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 75));
        },
    },
    {
        id: 'ch-andalusian',
        name: 'Andalusian Cadence',
        category: 'chords',
        genres: ['classical', 'world', 'metal'],
        tags: ['flamenco', 'dramatic'],
        description: 'Spanish cadence i–VII–VI–V',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'harmonic-minor', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(57, sp)) - 0);
            return [
                [0, 2, 4],
                [6, 8, 10],
                [5, 7, 9],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 80));
        },
    },
    {
        id: 'ch-dorian',
        name: 'Dorian Vamp',
        category: 'chords',
        genres: ['funk', 'jazz', 'r&b'],
        tags: ['groove', 'modal'],
        description: 'Two-chord dorian groove',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'dorian', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(62, sp)) - 0);
            return [
                [0, 2, 4, 6],
                [5, 7, 9, 11],
            ].flatMap((deg, i) => chordFromDegrees(p.complexity > 5 ? deg : deg.slice(0, 3), sp, o, i * 4, 4, 78));
        },
    },
    {
        id: 'ch-edm',
        name: 'EDM Power',
        category: 'chords',
        genres: ['edm', 'house', 'techno'],
        tags: ['big', 'anthem'],
        description: 'Big EDM chord stabs',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale === 'major' ? 'minor' : p.scale, 36, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(45, sp)) - 0);
            return [0, 3, 5, 4].flatMap((root, i) => {
                const deg = [root, root + 2, root + 4];
                const b = i * 4;
                return [...chordFromDegrees(deg, sp, o, b, 2, 100), ...chordFromDegrees(deg, sp, o, b + 2, 2, 90)];
            });
        },
    },
    {
        id: 'ch-gospel',
        name: 'Gospel IV–vi–iii',
        category: 'chords',
        genres: ['gospel', 'soul', 'r&b'],
        tags: ['worship', 'uplifting'],
        description: 'Gospel praise progression',
        lengthBeats: 12,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(60, sp)) - 0);
            return [
                [3, 5, 7, 9],
                [5, 7, 9, 11],
                [2, 4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(p.complexity > 5 ? deg : deg.slice(0, 3), sp, o, i * 4, 4, 82));
        },
    },
    {
        id: 'ch-trap',
        name: 'Trap Minor',
        category: 'chords',
        genres: ['trap', 'hip-hop'],
        tags: ['dark', '808'],
        description: 'Dark minor trap chords',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 36, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(48, sp)) - 0);
            return [0, 6, 5, 4].flatMap((root, i) => chordFromDegrees([root, root + 2, root + 4], sp, o, i * 4, 4, 85));
        },
    },
    {
        id: 'ch-synthpad',
        name: 'Synthwave Pad',
        category: 'chords',
        genres: ['synthwave', 'ambient', 'cinematic'],
        tags: ['pad', 'atmospheric'],
        description: 'Atmospheric synth pads',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(57, sp)) - 0);
            return [
                [0, 2, 4, 7],
                [3, 5, 7, 10],
                [4, 6, 8, 11],
                [2, 4, 6, 9],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 68));
        },
    },
    {
        id: 'ch-reggae',
        name: 'Reggae Skank',
        category: 'chords',
        genres: ['reggae', 'world'],
        tags: ['offbeat', 'island'],
        description: 'Offbeat reggae chords',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            const o = 0;
            return [
                [0, 2, 4],
                [4, 6, 8],
                [5, 7, 9],
                [3, 5, 7],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 2 + 0.5, 0.5, 75));
        },
    },
    {
        id: 'ch-country',
        name: 'Country I–IV–V',
        category: 'chords',
        genres: ['country', 'rock', 'pop'],
        tags: ['simple', 'classic'],
        description: 'Simple three-chord country',
        lengthBeats: 16,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 48, 84);
            const o = Math.max(0, sp.indexOf(snapToScale(55, sp)) - 0);
            return [
                [0, 2, 4],
                [0, 2, 4],
                [3, 5, 7],
                [4, 6, 8],
            ].flatMap((deg, i) => chordFromDegrees(deg, sp, o, i * 4, 4, 80));
        },
    },
    {
        id: 'ch-disco',
        name: 'Disco Groove',
        category: 'chords',
        genres: ['disco', 'funk', 'house'],
        tags: ['danceable', 'retro'],
        description: 'Rhythmic disco chords',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, p.scale, 60, 84);
            const o = 0;
            const notes: PatternNote[] = [];
            for (const [i, deg] of [
                [0, 2, 4],
                [5, 7, 9],
                [3, 5, 7],
                [4, 6, 8],
            ].entries()) {
                notes.push(...chordFromDegrees(deg, sp, o, i * 2, 1, 80));
                notes.push(...chordFromDegrees(deg, sp, o, i * 2 + 1, 0.5, 65));
            }
            return notes;
        },
    },
    {
        id: 'ch-dnb',
        name: 'DnB Stab',
        category: 'chords',
        genres: ['dnb', 'edm'],
        tags: ['stab', 'energy'],
        description: 'Quick synth stabs',
        lengthBeats: 8,
        generate: (p) => {
            const sp = getScalePitches(p.key, 'minor', 60, 84);
            const o = 0;
            return [
                [0, 2, 4],
                [3, 5, 7],
                [4, 6, 8],
            ].flatMap((deg, i) => [
                ...chordFromDegrees(deg, sp, o, i * 2.5, 0.25, 100),
                ...chordFromDegrees(deg, sp, o, i * 2.5 + 1.5, 0.25, 85),
            ]);
        },
    },

];
