import { updateNotesForClip } from '../midiNoteCrud/updateNotesForClip';

type VelocityCurve = 'linear' | 'exponential' | 'logarithmic' | 's-curve' | 'compress' | 'expand';

function isVelocityCurve(curve: string): curve is VelocityCurve {
    return (
        curve === 'linear' ||
        curve === 'exponential' ||
        curve === 'logarithmic' ||
        curve === 's-curve' ||
        curve === 'compress' ||
        curve === 'expand'
    );
}

function applyMidiVelocityCurve(normalized: number, curve: string): number {
    if (!isVelocityCurve(curve)) {
        return normalized;
    }
    switch (curve) {
        case 'linear': {
            return normalized;
        }
        case 'exponential': {
            return normalized * normalized;
        }
        case 'logarithmic': {
            return Math.sqrt(normalized);
        }
        case 's-curve': {
            if (normalized < 0.5) {
                return 2 * normalized * normalized;
            }
            return 1 - 2 * (1 - normalized) * (1 - normalized);
        }
        case 'compress': {
            return 0.3 + normalized * 0.4;
        }
        case 'expand': {
            if (normalized < 0.5) {
                return normalized * 0.3;
            }
            return 0.7 + (normalized - 0.5) * 1.4;
        }
    }
}

export function scaleVelocities(clipId: string, curve: string, minVelocity = 1, maxVelocity = 127): void {
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
            const curved = applyMidiVelocityCurve(normalized, curve);
            const newVelocity = Math.round(minVelocity + curved * (maxVelocity - minVelocity));
            return {
                ...node,
                velocity: Math.max(1, Math.min(127, newVelocity)),
            };
        });
    });
}
