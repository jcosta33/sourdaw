import { type Step } from '../models/ToasterKit';

import { projectToasterPatternGroove } from './projectToasterPatternGroove';

const LOOP_EDGE_EPSILON_BEATS = 1 / 960;

type ProjectToasterStepEventsInput = {
    deviceId: string;
    patternId: string;
    stepsPerBar: number;
    loopLengthBeats: number;
    padIndex: number;
    stepIndex: number;
    step: Step;
    swing: number;
};

export function projectToasterStepEvents(input: ProjectToasterStepEventsInput) {
    const stepDurationBeats = 4 / input.stepsPerBar;
    const gridStartBeat = input.stepIndex * stepDurationBeats;
    const microOffsetBeats = input.step.microTiming * stepDurationBeats;
    const swingBeats = input.stepIndex % 2 === 1 ? input.swing * stepDurationBeats * 0.5 : 0;
    const sourceEvent = {
        id: `${input.padIndex}:${input.stepIndex}`,
        startBeat: Math.max(0, gridStartBeat + microOffsetBeats + swingBeats),
        velocity: Math.round(input.step.velocity * 127),
    };
    const grooveProjection = projectToasterPatternGroove({
        deviceId: input.deviceId,
        patternId: input.patternId,
        stepsPerBar: input.stepsPerBar,
        events: [sourceEvent],
    });
    if (!grooveProjection.ok) {
        return grooveProjection;
    }

    const projectedEvent = grooveProjection.events[0] ?? sourceEvent;
    const latestStartBeat = Math.max(0, input.loopLengthBeats - LOOP_EDGE_EPSILON_BEATS);
    function projectHit(startBeat: number, durationBeats: number, velocity: number, retriggerIndex: number) {
        const boundedStartBeat = Math.max(0, Math.min(latestStartBeat, startBeat));
        return {
            startBeat: boundedStartBeat,
            durationBeats: Math.max(0, Math.min(durationBeats, input.loopLengthBeats - boundedStartBeat)),
            velocity,
            retriggerIndex,
        };
    }
    const hits = [projectHit(projectedEvent.startBeat, stepDurationBeats * 0.9, projectedEvent.velocity, 0)];

    if (input.step.retriggerCount > 0) {
        const subInterval = stepDurationBeats / (input.step.retriggerCount + 1);
        for (let retrigger = 1; retrigger <= input.step.retriggerCount; retrigger++) {
            hits.push(
                projectHit(
                    projectedEvent.startBeat + subInterval * retrigger,
                    subInterval * 0.9,
                    Math.max(20, Math.round(projectedEvent.velocity * (1 - retrigger * 0.12))),
                    retrigger
                )
            );
        }
    }

    return { ok: true as const, hits, status: grooveProjection.status };
}
