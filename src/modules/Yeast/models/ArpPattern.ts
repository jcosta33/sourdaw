/**
 * Arp pattern step model — per-step controls for the custom pattern editor.
 */

export type StepType = 'note' | 'rest' | 'tie' | 'chord' | 'random';

export type NoteSelector =
    | { type: 'next' }
    | { type: 'previous' }
    | { type: 'index'; index: number }
    | { type: 'random' }
    | { type: 'lowest' }
    | { type: 'highest' };

export type ArpStep = {
    active: boolean;
    stepType: StepType;
    noteSelector: NoteSelector;
    velocity: number;          // 1-127
    velocityOverride: boolean; // if false, use source velocity
    gateMul: number;           // 0.1-2.0 multiplier on base gate
    octaveOffset: number;      // -3 to +3
    semitoneOffset: number;    // -12 to +12
    probability: number;       // 0.0-1.0
    ratchet: number;           // 1-4 subdivisions within this step
};

export function defaultStep(): ArpStep {
    return {
        active: true,
        stepType: 'note',
        noteSelector: { type: 'next' },
        velocity: 100,
        velocityOverride: false,
        gateMul: 1.0,
        octaveOffset: 0,
        semitoneOffset: 0,
        probability: 1.0,
        ratchet: 1,
    };
}

export function createDefaultPattern(length: number): ArpStep[] {
    return Array.from({ length }, () => defaultStep());
}
