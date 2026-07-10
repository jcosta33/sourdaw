import { type GeneratedFill } from '../../models/FillTransitionTypes';

import { DRUM_MAP, FILL_PATTERNS } from './generation';

export function generateDrumFill(
    atBeat: number,
    durationBeats: number = 2,
    style: string = 'descending'
): GeneratedFill {
    const pattern =
        style === 'simple' || style === 'descending' || style === 'sixteenth' || style === 'syncopated'
            ? FILL_PATTERNS[style]
            : FILL_PATTERNS.descending;
    const notes: GeneratedFill['notes'] = [];

    const barsSpanned = Math.max(1, Math.floor(durationBeats));
    for (let beat = 0; beat < barsSpanned; beat++) {
        for (const hit of pattern) {
            const noteStart = atBeat + beat + hit.offset;
            const progress = (beat + hit.offset) / barsSpanned;
            const dynVelocity = Math.min(127, Math.round(hit.velocity * (0.8 + progress * 0.4)));

            notes.push({
                pitch: hit.pitch,
                startBeat: noteStart,
                duration: 0.25,
                velocity: dynVelocity,
            });
        }
    }

    notes.push({
        pitch: DRUM_MAP.crash,
        startBeat: atBeat + durationBeats,
        duration: 1,
        velocity: 120,
    });

    return { notes, durationBeats, style: 'drum-fill', confidence: 0.85 };
}
