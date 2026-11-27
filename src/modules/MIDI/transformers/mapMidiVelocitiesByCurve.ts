import { clampVelocity } from '#/utils/midiData';

import { type MidiNote } from '../models/MidiNote';

type MapMidiVelocitiesByCurveInput = {
    notes: readonly MidiNote[];
    curve: string;
    minVelocity: number;
    maxVelocity: number;
};

function applyMidiVelocityCurve(normalized: number, curve: string): number {
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
        default: {
            // An unrecognised curve name leaves the span linear.
            return normalized;
        }
    }
}

/** The velocities the clip's softest..loudest span lands on after `curve`, mapped onto `minVelocity..maxVelocity`. */
export function mapMidiVelocitiesByCurve(input: MapMidiVelocitiesByCurveInput): MidiNote[] {
    let currentMin = Infinity;
    let currentMax = -Infinity;
    for (const node of input.notes) {
        currentMin = Math.min(currentMin, node.velocity);
        currentMax = Math.max(currentMax, node.velocity);
    }
    const range = currentMax - currentMin || 1;

    return input.notes.map((node) => {
        const normalized = (node.velocity - currentMin) / range;
        // The expand curve overshoots 1, which would otherwise land above maxVelocity.
        const curved = Math.min(1, Math.max(0, applyMidiVelocityCurve(normalized, input.curve)));
        const newVelocity = Math.round(input.minVelocity + curved * (input.maxVelocity - input.minVelocity));
        return { ...node, velocity: clampVelocity(newVelocity) };
    });
}
