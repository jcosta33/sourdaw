import { type Step } from '../models/ToasterKit';

import { projectToasterPatternGroove } from './projectToasterPatternGroove';

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
    let swingBeats = 0;
    if (input.stepIndex % 2 === 1) {
        swingBeats = input.swing * stepDurationBeats * 0.5;
    }
    const sourceEvent = {
        id: `${input.padIndex}:${input.stepIndex}`,
        startBeat: gridStartBeat + microOffsetBeats + swingBeats,
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
    const hits: Array<{
        startBeat: number;
        durationBeats: number;
        velocity: number;
        retriggerIndex: number;
        loopOffsetBeats: number;
    }> = [];
    function appendHitSegments(
        startBeat: number,
        durationBeats: number,
        velocity: number,
        retriggerIndex: number
    ): void {
        if (input.loopLengthBeats <= 0 || durationBeats <= 0) {
            return;
        }
        const sourceLoopIndex = Math.floor(startBeat / input.loopLengthBeats);
        let wrappedStartBeat = startBeat;
        if (startBeat < 0 || startBeat >= input.loopLengthBeats) {
            wrappedStartBeat = ((startBeat % input.loopLengthBeats) + input.loopLengthBeats) % input.loopLengthBeats;
        }
        const firstLoopOffsetBeats = Math.max(0, sourceLoopIndex) * input.loopLengthBeats;
        const preservedDuration = Math.min(durationBeats, input.loopLengthBeats);
        const firstDuration = Math.min(preservedDuration, input.loopLengthBeats - wrappedStartBeat);
        const remainingDuration = preservedDuration - firstDuration;
        if (remainingDuration > 0) {
            let nextLoopOffsetBeats = (sourceLoopIndex + 1) * input.loopLengthBeats;
            if (sourceLoopIndex < 0) {
                nextLoopOffsetBeats = 0;
            }
            hits.push({
                startBeat: 0,
                durationBeats: remainingDuration,
                velocity,
                retriggerIndex,
                loopOffsetBeats: nextLoopOffsetBeats,
            });
        }
        if (firstDuration > 0) {
            hits.push({
                startBeat: wrappedStartBeat,
                durationBeats: firstDuration,
                velocity,
                retriggerIndex,
                loopOffsetBeats: firstLoopOffsetBeats,
            });
        }
    }
    appendHitSegments(projectedEvent.startBeat, stepDurationBeats * 0.9, projectedEvent.velocity, 0);

    if (input.step.retriggerCount > 0) {
        const subInterval = stepDurationBeats / (input.step.retriggerCount + 1);
        for (let retrigger = 1; retrigger <= input.step.retriggerCount; retrigger++) {
            appendHitSegments(
                projectedEvent.startBeat + subInterval * retrigger,
                subInterval * 0.9,
                Math.max(20, Math.round(projectedEvent.velocity * (1 - retrigger * 0.12))),
                retrigger
            );
        }
    }

    hits.sort((alpha, beta) => {
        const loopOrder = alpha.loopOffsetBeats - beta.loopOffsetBeats;
        if (loopOrder !== 0) {
            return loopOrder;
        }
        const startOrder = alpha.startBeat - beta.startBeat;
        if (startOrder !== 0) {
            return startOrder;
        }
        return alpha.retriggerIndex - beta.retriggerIndex;
    });

    return { ok: true as const, hits, status: grooveProjection.status };
}
