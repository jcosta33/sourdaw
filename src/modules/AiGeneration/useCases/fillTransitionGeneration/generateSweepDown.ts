import { type GeneratedFill } from '../../models/FillTransitionTypes';

export function generateSweepDown(
    atBeat: number,
    durationBeats: number = 2,
    startPitch: number = 84,
    endPitch: number = 36
): GeneratedFill {
    const notes: GeneratedFill['notes'] = [];
    const velStart = 100;
    const velEnd = 60;
    const steps = Math.floor(durationBeats * 4);

    for (let index = 0; index < steps; index++) {
        const progress = index / steps;

        notes.push({
            pitch: Math.round(startPitch + (endPitch - startPitch) * progress),
            startBeat: atBeat + (index * durationBeats) / steps,
            duration: durationBeats / steps,
            velocity: Math.min(127, Math.round(velStart + (velEnd - velStart) * progress)),
        });
    }

    return { notes, durationBeats, style: 'sweep-down', confidence: 0.7 };
}
