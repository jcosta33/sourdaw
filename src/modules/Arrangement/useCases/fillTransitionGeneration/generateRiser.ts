import { type GeneratedFill } from '../../models/FillTransitionTypes';

export function generateRiser(
    atBeat: number,
    durationBeats: number = 4,
    startPitch: number = 60,
    endPitch: number = 84
): GeneratedFill {
    const notes: GeneratedFill['notes'] = [];
    const velStart = 60;
    const velEnd = 127;
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

    return { notes, durationBeats, style: 'riser', confidence: 0.75 };
}
