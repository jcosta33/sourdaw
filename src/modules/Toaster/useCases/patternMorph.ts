/**
 * Pattern morphing — interpolate between two patterns.
 * Triggers are treated as probabilities; velocity/microtiming are interpolated.
 */

import { type Pattern, type Step } from '../models/ToasterKit';

function lerpStep(alpha: Step, b: Step, time: number): Step {
    return {
        active: Math.random() < (alpha.active ? 1 - time : 0) + (b.active ? time : 0),
        velocity: alpha.velocity * (1 - time) + b.velocity * time,
        probability: alpha.probability * (1 - time) + b.probability * time,
        microTiming: alpha.microTiming * (1 - time) + b.microTiming * time,
        retriggerCount: time < 0.5 ? alpha.retriggerCount : b.retriggerCount,
        condition: time < 0.5 ? alpha.condition : b.condition,
        paramLocks: time < 0.5 ? alpha.paramLocks : b.paramLocks,
    };
}

/**
 * Create a morphed pattern between A and B at position t (0=A, 1=B).
 * Assumes both patterns have the same number of tracks and steps.
 */
export function morphPatterns(alpha: Pattern, b: Pattern, time: number): Pattern {
    const clamped = Math.max(0, Math.min(1, time));

    // At the endpoints, morphPatterns was the hot-spot in §62.2 because
    // sequencerPlayback ticks call it every step with t=0 or t=1, and
    // this function still allocates a whole new pattern shape for values
    // that are byte-identical to one of the inputs. Early-return.
    if (clamped === 0) {
        return alpha;
    }
    if (clamped === 1) {
        return b;
    }

    const tracks = alpha.tracks.map((trackA, ti) => {
        const trackB = b.tracks[ti];
        if (!trackB) {
            return trackA;
        }

        const maxSteps = Math.max(trackA.steps.length, trackB.steps.length);
        const steps: Step[] = [];
        for (let state = 0; state < maxSteps; state++) {
            const stepA = trackA.steps[state] ?? {
                active: false,
                velocity: 0.8,
                probability: 1,
                microTiming: 0,
                retriggerCount: 0,
                condition: 'always' as const,
                paramLocks: {},
            };
            const stepB = trackB.steps[state] ?? stepA;
            steps.push(lerpStep(stepA, stepB, clamped));
        }

        return {
            padIndex: trackA.padIndex,
            steps,
            stepsOverride: clamped < 0.5 ? trackA.stepsOverride : trackB.stepsOverride,
        };
    });

    return {
        id: `morph-${alpha.id}-${b.id}`,
        name: `${alpha.name} → ${b.name}`,
        stepsPerBar: clamped < 0.5 ? alpha.stepsPerBar : b.stepsPerBar,
        bars: clamped < 0.5 ? alpha.bars : b.bars,
        tracks,
    };
}
