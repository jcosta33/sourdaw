/**
 * Pattern morphing — interpolate between two patterns.
 * Triggers are treated as probabilities; velocity/microtiming are interpolated.
 */

import { type Pattern, type Step } from '../models/ToasterKit';

function lerpStep(a: Step, b: Step, t: number): Step {
    return {
        active: Math.random() < (a.active ? 1 - t : 0) + (b.active ? t : 0),
        velocity: a.velocity * (1 - t) + b.velocity * t,
        probability: a.probability * (1 - t) + b.probability * t,
        microTiming: a.microTiming * (1 - t) + b.microTiming * t,
        retriggerCount: t < 0.5 ? a.retriggerCount : b.retriggerCount,
        condition: t < 0.5 ? a.condition : b.condition,
        paramLocks: t < 0.5 ? a.paramLocks : b.paramLocks,
    };
}

/**
 * Create a morphed pattern between A and B at position t (0=A, 1=B).
 * Assumes both patterns have the same number of tracks and steps.
 */
export function morphPatterns(a: Pattern, b: Pattern, t: number): Pattern {
    const clamped = Math.max(0, Math.min(1, t));

    const tracks = a.tracks.map((trackA, ti) => {
        const trackB = b.tracks[ti];
        if (!trackB) { return trackA; }

        const maxSteps = Math.max(trackA.steps.length, trackB.steps.length);
        const steps: Step[] = [];
        for (let s = 0; s < maxSteps; s++) {
            const stepA = trackA.steps[s] ?? { active: false, velocity: 0.8, probability: 1, microTiming: 0, retriggerCount: 0, condition: 'always' as const, paramLocks: {} };
            const stepB = trackB.steps[s] ?? stepA;
            steps.push(lerpStep(stepA, stepB, clamped));
        }

        return {
            padIndex: trackA.padIndex,
            steps,
            stepsOverride: clamped < 0.5 ? trackA.stepsOverride : trackB.stepsOverride,
        };
    });

    return {
        id: `morph-${a.id}-${b.id}`,
        name: `${a.name} → ${b.name}`,
        stepsPerBar: clamped < 0.5 ? a.stepsPerBar : b.stepsPerBar,
        bars: clamped < 0.5 ? a.bars : b.bars,
        tracks,
    };
}
