import { applyVelocityCurve, type VelocityCurve } from '#/modules/Arrangement/useCases';
import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function scaleVelocities(
    clipId: string,
    curve: VelocityCurve,
    minVelocity = 1,
    maxVelocity = 127
): void {
    updateNotesForClip(clipId, (notes) => {
        let currentMin = Infinity;
        let currentMax = -Infinity;
        for (const n of notes) {
            if (n.velocity < currentMin) { currentMin = n.velocity; }
            if (n.velocity > currentMax) { currentMax = n.velocity; }
        }
        const range = currentMax - currentMin || 1;

        return notes.map((n) => {
            const normalized = (n.velocity - currentMin) / range;
            const curved = applyVelocityCurve(normalized, curve);
            const newVelocity = Math.round(minVelocity + curved * (maxVelocity - minVelocity));
            return {
                ...n,
                velocity: Math.max(1, Math.min(127, newVelocity)),
            };
        });
    });
}
