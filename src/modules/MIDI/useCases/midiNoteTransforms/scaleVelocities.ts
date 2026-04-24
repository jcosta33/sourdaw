import { applyVelocityCurve, type VelocityCurve } from '#/modules/Arrangement/useCases';

import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

export function scaleVelocities(clipId: string, curve: VelocityCurve, minVelocity = 1, maxVelocity = 127): void {
    updateNotesForClip(clipId, (notes) => {
        let currentMin = Infinity;
        let currentMax = -Infinity;
        for (const node of notes) {
            if (node.velocity < currentMin) {
                currentMin = node.velocity;
            }
            if (node.velocity > currentMax) {
                currentMax = node.velocity;
            }
        }
        const range = currentMax - currentMin || 1;

        return notes.map((node) => {
            const normalized = (node.velocity - currentMin) / range;
            const curved = applyVelocityCurve(normalized, curve);
            const newVelocity = Math.round(minVelocity + curved * (maxVelocity - minVelocity));
            return {
                ...node,
                velocity: Math.max(1, Math.min(127, newVelocity)),
            };
        });
    });
}
