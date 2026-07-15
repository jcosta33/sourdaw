import { type PatternTemplate, type PatternNote } from '../../models/MidiPatternType';
import { getScalePitches } from '../scaleTheory';

/** Melody pattern templates — arpeggios, runs, motifs across jazz, pop, ambient, and more. */
export const melodyPatterns: PatternTemplate[] = [
    {
        id: 'ml-arpmaj',
        name: 'Major Arpeggio',
        category: 'melody',
        genres: ['pop', 'edm', 'classical'],
        tags: ['arpeggio', 'bright'],
        description: 'Ascending/descending arpeggio',
        lengthBeats: 4,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            const pattern = param.complexity > 5 ? [0, 2, 4, 7, 4, 2, 0, 2] : [0, 2, 4, 7, 4, 2, 0, 2];
            return pattern.map((deg, index) => ({
                pitch: sp[Math.min(deg, sp.length - 1)]!,
                velocity: 75 + param.density,
                startBeat: index * 0.5,
                durationBeats: 0.5,
            }));
        },
    },
    {
        id: 'ml-arpmin',
        name: 'Minor Arpeggio',
        category: 'melody',
        genres: ['pop', 'r&b', 'cinematic'],
        tags: ['arpeggio', 'dark'],
        description: 'Minor arpeggio pattern',
        lengthBeats: 4,
        scaleOverride: 'minor',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 57, 84);
            return [0, 2, 4, 7, 4, 2, 0, 2].map((deg, index) => ({
                pitch: sp[Math.min(deg, sp.length - 1)]!,
                velocity: 75 + param.density,
                startBeat: index * 0.5,
                durationBeats: 0.5,
            }));
        },
    },
    {
        id: 'ml-scale',
        name: 'Scale Run',
        category: 'melody',
        genres: ['classical', 'pop'],
        tags: ['scale', 'educational'],
        description: 'Ascending scale run',
        lengthBeats: 8,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            return sp.slice(0, 8).map((pitch, index) => ({ pitch, velocity: 80, startBeat: index, durationBeats: 1 }));
        },
    },
    {
        id: 'ml-pent',
        name: 'Pentatonic Riff',
        category: 'melody',
        genres: ['rock', 'blues'],
        tags: ['riff', 'guitar'],
        description: 'Pentatonic rock riff',
        lengthBeats: 4,
        scaleOverride: 'pentatonic-minor',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 57, 79);
            return [
                { pitch: sp[0]!, velocity: 85, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 80, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 90, startBeat: 1, durationBeats: 1 },
                { pitch: sp[4]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[Math.min(6, sp.length - 1)]!, velocity: 80, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 80, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'ml-blues',
        name: 'Blues Lick',
        category: 'melody',
        genres: ['blues', 'rock'],
        tags: ['lick', 'classic'],
        description: 'Classic blues guitar lick',
        lengthBeats: 4,
        scaleOverride: 'blues',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 57, 79);
            return [
                { pitch: sp[2]!, velocity: 85, startBeat: 0, durationBeats: 0.25 },
                { pitch: sp[3]!, velocity: 80, startBeat: 0.25, durationBeats: 0.25 },
                { pitch: sp[4]!, velocity: 90, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 75, startBeat: 1, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 80, startBeat: 1.5, durationBeats: 1 },
                { pitch: sp[2]!, velocity: 75, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 85, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'ml-edm',
        name: 'EDM Arp',
        category: 'melody',
        genres: ['edm', 'house', 'techno'],
        tags: ['arpeggio', 'electronic'],
        description: 'Fast electronic arpeggio',
        lengthBeats: 4,
        scaleOverride: 'minor',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 57, 84);
            const step = param.density > 7 ? 0.125 : 0.25;
            const notes: PatternNote[] = [];
            const degs = [0, 2, 4, 7];
            for (let b = 0; b < 4; b += step) {
                notes.push({
                    pitch: sp[Math.min(degs[Math.floor(b / step) % 4]!, sp.length - 1)]!,
                    velocity: 75 + param.density * 2,
                    startBeat: b,
                    durationBeats: step,
                });
            }
            return notes;
        },
    },
    {
        id: 'ml-lofi',
        name: 'Lo-Fi Melody',
        category: 'melody',
        genres: ['lo-fi', 'jazz', 'hip-hop'],
        tags: ['chill', 'jazzy'],
        description: 'Relaxed lo-fi jazz melody',
        lengthBeats: 4,
        scaleOverride: 'dorian',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            return [
                { pitch: sp[4]!, velocity: 70, startBeat: 0, durationBeats: 1 },
                { pitch: sp[6]!, velocity: 65, startBeat: 1, durationBeats: 0.5 },
                { pitch: sp[8] || sp[7]!, velocity: 60, startBeat: 1.5, durationBeats: 1.5 },
                { pitch: sp[7]!, velocity: 65, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[6]!, velocity: 70, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'ml-synthwave',
        name: 'Synthwave Lead',
        category: 'melody',
        genres: ['synthwave', 'cinematic'],
        tags: ['retro', '80s'],
        description: '80s-style synth lead',
        lengthBeats: 8,
        scaleOverride: 'minor',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            return [
                { pitch: sp[7] || sp[6]!, velocity: 85, startBeat: 0, durationBeats: 1.5 },
                { pitch: sp[8] || sp[7]!, velocity: 80, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 75, startBeat: 2, durationBeats: 1 },
                { pitch: sp[6]!, velocity: 80, startBeat: 3, durationBeats: 1 },
                { pitch: sp[4]!, velocity: 85, startBeat: 4, durationBeats: 1.5 },
                { pitch: sp[6]!, velocity: 80, startBeat: 5.5, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 90, startBeat: 6, durationBeats: 2 },
            ];
        },
    },
    {
        id: 'ml-trap',
        name: 'Trap Melody',
        category: 'melody',
        genres: ['trap', 'hip-hop'],
        tags: ['dark', 'bell'],
        description: 'Dark trap bell melody',
        lengthBeats: 4,
        scaleOverride: 'minor',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            return [
                { pitch: sp[8] || sp[7]!, velocity: 90, startBeat: 0, durationBeats: 0.25 },
                { pitch: sp[9] || sp[8]!, velocity: 85, startBeat: 0.25, durationBeats: 0.25 },
                { pitch: sp[8] || sp[7]!, velocity: 80, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[7]!, velocity: 85, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 80, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 75, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 90, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'ml-classical',
        name: 'Classical Phrase',
        category: 'melody',
        genres: ['classical', 'cinematic'],
        tags: ['elegant', 'period'],
        description: 'Classical melodic phrase',
        lengthBeats: 8,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            return [
                { pitch: sp[7] || sp[6]!, velocity: 75, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[6]!, velocity: 70, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 80, startBeat: 1, durationBeats: 1 },
                { pitch: sp[5]!, velocity: 75, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 70, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 80, startBeat: 3, durationBeats: 1 },
                { pitch: sp[7] || sp[6]!, velocity: 85, startBeat: 4, durationBeats: 0.5 },
                { pitch: sp[8] || sp[7]!, velocity: 80, startBeat: 4.5, durationBeats: 0.5 },
                { pitch: sp[9] || sp[8]!, velocity: 85, startBeat: 5, durationBeats: 1 },
                { pitch: sp[8] || sp[7]!, velocity: 75, startBeat: 6, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 70, startBeat: 6.5, durationBeats: 0.5 },
                { pitch: sp[6]!, velocity: 80, startBeat: 7, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'ml-gospel',
        name: 'Gospel Run',
        category: 'melody',
        genres: ['gospel', 'soul', 'r&b'],
        tags: ['run', 'flashy'],
        description: 'Fast gospel piano run',
        lengthBeats: 4,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            const notes: PatternNote[] = [];
            for (let index = 0; index < 8 && index < sp.length; index++) {
                notes.push({ pitch: sp[index]!, velocity: 80 + index, startBeat: index * 0.25, durationBeats: 0.25 });
            }
            if (sp[8]) {
                notes.push({ pitch: sp[8], velocity: 90, startBeat: 2, durationBeats: 0.5 });
            }
            for (let index = 7; index >= 5 && index < sp.length; index--) {
                notes.push({
                    pitch: sp[index]!,
                    velocity: 75,
                    startBeat: 2.75 + (7 - index) * 0.25,
                    durationBeats: 0.25,
                });
            }
            return notes;
        },
    },
    {
        id: 'ml-country',
        name: 'Country Picking',
        category: 'melody',
        genres: ['country', 'rock'],
        tags: ['fingerpick', 'acoustic'],
        description: 'Fingerpicking pattern',
        lengthBeats: 4,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 48, 72);
            return [
                { pitch: sp[0]!, velocity: 85, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 80, startBeat: 1, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[2]!, velocity: 80, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'ml-afrobeat',
        name: 'Afrobeat Lick',
        category: 'melody',
        genres: ['afrobeat', 'world'],
        tags: ['african', 'rhythmic'],
        description: 'Afrobeat melodic lick',
        lengthBeats: 4,
        scaleOverride: 'pentatonic-major',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 60, 84);
            return [
                { pitch: sp[7] || sp[6]!, velocity: 85, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 80, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 75, startBeat: 1, durationBeats: 0.25 },
                { pitch: sp[3]!, velocity: 80, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[7] || sp[6]!, velocity: 80, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[5]!, velocity: 85, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 80, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
];
