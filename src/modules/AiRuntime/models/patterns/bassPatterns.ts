import { getScalePitches } from '../../services/scaleTheory';
import { type PatternTemplate, type PatternNote, KEY_SEMITONES } from '../MidiPatternType';

/** Bass pattern templates — walking bass, slap, sub, 808, latin, metal, and more. */
export const bassPatterns: PatternTemplate[] = [
    {
        id: 'bs-walking',
        name: 'Walking Bass',
        category: 'bass',
        genres: ['jazz', 'blues'],
        tags: ['classic', 'smooth'],
        description: 'Stepwise jazz walking bass',
        lengthBeats: 8,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 28, 55);
            const mid = Math.floor(sp.length / 2);
            const notes: PatternNote[] = [];
            let idx = mid;
            for (let b = 0; b < 8; b++) {
                notes.push({
                    pitch: sp[idx]!,
                    velocity: 80 + Math.round(param.density * 2),
                    startBeat: b,
                    durationBeats: 1,
                });
                idx += b < 4 ? 1 : -1;
                idx = Math.max(0, Math.min(sp.length - 1, idx));
            }
            return notes;
        },
    },
    {
        id: 'bs-octpump',
        name: 'Octave Pump',
        category: 'bass',
        genres: ['rock', 'metal'],
        tags: ['driving', 'power'],
        description: 'Root-octave pump pattern',
        lengthBeats: 4,
        generate: (param) => {
            const root = (KEY_SEMITONES[param.key] ?? 0) + 28;
            const step = param.density > 5 ? 0.25 : 0.5;
            const notes: PatternNote[] = [];
            for (let b = 0; b < 4; b += step) {
                notes.push({
                    pitch: b % (step * 2) < step ? root : root + 12,
                    velocity: b % (step * 2) < step ? 100 : 85,
                    startBeat: b,
                    durationBeats: step,
                });
            }
            return notes;
        },
    },
    {
        id: 'bs-funkslap',
        name: 'Funk Slap',
        category: 'bass',
        genres: ['funk', 'r&b', 'disco'],
        tags: ['groove', 'slap'],
        description: 'Syncopated funk bass',
        lengthBeats: 4,
        scaleOverride: 'pentatonic-minor',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 28, 48);
            const r = sp[0]!;
            return [
                { pitch: r, velocity: 110, startBeat: 0, durationBeats: 0.25 },
                { pitch: r + 12, velocity: 95, startBeat: 0.75, durationBeats: 0.25 },
                { pitch: r, velocity: 100, startBeat: 1.5, durationBeats: 0.25 },
                { pitch: r + 12, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: r, velocity: 110, startBeat: 3, durationBeats: 0.25 },
                { pitch: sp[1]!, velocity: 80, startBeat: 3.5, durationBeats: 0.25 },
            ];
        },
    },
    {
        id: 'bs-sub',
        name: 'Sub Bass',
        category: 'bass',
        genres: ['edm', 'house', 'techno', 'trap'],
        tags: ['sub', 'sustained'],
        description: 'Long sustained sub bass notes',
        lengthBeats: 16,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 28, 48);
            return [0, 3, 5, 4].map((deg, index) => ({
                pitch: sp[Math.min(deg, sp.length - 1)]!,
                velocity: 100,
                startBeat: index * 4,
                durationBeats: 4,
            }));
        },
    },
    {
        id: 'bs-hiphop',
        name: 'Hip-Hop Bounce',
        category: 'bass',
        genres: ['hip-hop', 'trap', 'r&b'],
        tags: ['bounce', '808'],
        description: '808-style bouncy bass',
        lengthBeats: 4,
        generate: (param) => {
            const root = (KEY_SEMITONES[param.key] ?? 0) + 36;
            return [
                { pitch: root, velocity: 110, startBeat: 0, durationBeats: 1.5 },
                { pitch: root, velocity: 90, startBeat: 2, durationBeats: 0.25 },
                { pitch: root - 2, velocity: 85, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: root, velocity: 100, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-latin',
        name: 'Latin Tumbao',
        category: 'bass',
        genres: ['latin', 'afrobeat', 'world'],
        tags: ['tumbao', 'salsa'],
        description: 'Salsa/Latin tumbao bass',
        lengthBeats: 4,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 28, 55);
            const r = sp[0]!;
            return [
                { pitch: r, velocity: 90, startBeat: 0, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 80, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 85, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: r, velocity: 90, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-reggae',
        name: 'Reggae Drop',
        category: 'bass',
        genres: ['reggae', 'world'],
        tags: ['offbeat', 'dub'],
        description: 'Reggae one-drop bass',
        lengthBeats: 4,
        generate: (param) => {
            const root = (KEY_SEMITONES[param.key] ?? 0) + 33;
            return [
                { pitch: root, velocity: 90, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: root, velocity: 85, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-metal',
        name: 'Metal Gallop',
        category: 'bass',
        genres: ['metal', 'rock'],
        tags: ['aggressive', 'chug'],
        description: 'Galloping metal bass',
        lengthBeats: 4,
        generate: (param) => {
            const root = (KEY_SEMITONES[param.key] ?? 0) + 28;
            const notes: PatternNote[] = [];
            for (let b = 0; b < 4; b++) {
                notes.push({ pitch: root, velocity: 110, startBeat: b, durationBeats: 0.25 });
                notes.push({ pitch: root, velocity: 80, startBeat: b + 0.25, durationBeats: 0.25 });
                notes.push({ pitch: root, velocity: 110, startBeat: b + 0.5, durationBeats: 0.25 });
            }
            return notes;
        },
    },
    {
        id: 'bs-ambient',
        name: 'Ambient Drone',
        category: 'bass',
        genres: ['ambient', 'cinematic'],
        tags: ['pad', 'atmospheric'],
        description: 'Single sustained drone note',
        lengthBeats: 16,
        generate: (param) => {
            const root = (KEY_SEMITONES[param.key] ?? 0) + 36;
            return [{ pitch: root, velocity: 55 + param.density * 3, startBeat: 0, durationBeats: 16 }];
        },
    },
    {
        id: 'bs-disco',
        name: 'Disco Bass',
        category: 'bass',
        genres: ['disco', 'funk', 'house'],
        tags: ['groove', 'danceable'],
        description: 'Groovy disco bass line',
        lengthBeats: 4,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 28, 55);
            const r = sp[0]!;
            return [
                { pitch: r, velocity: 95, startBeat: 0, durationBeats: 0.5 },
                { pitch: r, velocity: 70, startBeat: 0.5, durationBeats: 0.5 },
                { pitch: r, velocity: 95, startBeat: 1, durationBeats: 0.5 },
                { pitch: r, velocity: 70, startBeat: 1.5, durationBeats: 0.5 },
                { pitch: r, velocity: 95, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[3]!, velocity: 80, startBeat: 2.5, durationBeats: 0.5 },
                { pitch: sp[4]!, velocity: 85, startBeat: 3, durationBeats: 0.5 },
                { pitch: sp[5] || sp[4]!, velocity: 80, startBeat: 3.5, durationBeats: 0.5 },
            ];
        },
    },
    {
        id: 'bs-country',
        name: 'Country Root-Fifth',
        category: 'bass',
        genres: ['country', 'pop'],
        tags: ['simple', 'classic'],
        description: 'Simple root-fifth alternation',
        lengthBeats: 4,
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 28, 55);
            return [
                { pitch: sp[0]!, velocity: 90, startBeat: 0, durationBeats: 1 },
                { pitch: sp[0]!, velocity: 80, startBeat: 1, durationBeats: 1 },
                { pitch: sp[4] || sp[3]!, velocity: 85, startBeat: 2, durationBeats: 1 },
                { pitch: sp[4] || sp[3]!, velocity: 80, startBeat: 3, durationBeats: 1 },
            ];
        },
    },
    {
        id: 'bs-dnb',
        name: 'DnB Reese',
        category: 'bass',
        genres: ['dnb', 'edm'],
        tags: ['reese', 'dark'],
        description: 'Aggressive DnB bass pattern',
        lengthBeats: 8,
        scaleOverride: 'minor',
        generate: (param) => {
            const sp = getScalePitches(param.key, param.scale, 28, 48);
            return [
                { pitch: sp[0]!, velocity: 100, startBeat: 0, durationBeats: 1.5 },
                { pitch: sp[Math.min(6, sp.length - 1)]!, velocity: 85, startBeat: 2, durationBeats: 0.5 },
                { pitch: sp[0]!, velocity: 90, startBeat: 3, durationBeats: 1 },
                { pitch: sp[Math.min(3, sp.length - 1)]!, velocity: 100, startBeat: 4, durationBeats: 1.5 },
                { pitch: sp[0]!, velocity: 85, startBeat: 6, durationBeats: 0.5 },
                { pitch: sp[Math.min(6, sp.length - 1)]!, velocity: 90, startBeat: 7, durationBeats: 1 },
            ];
        },
    },
];
