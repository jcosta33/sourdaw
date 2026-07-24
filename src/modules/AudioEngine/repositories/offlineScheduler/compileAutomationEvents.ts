import { clampStairSteps, evaluateAutomationCurve } from '#/utils/automationCurve';

import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';

type AutomationTempoChange = { beat: number; tempo: number };
export type CompiledAutomationEvent = { type: 'set' | 'linear'; timeSeconds: number; value: number };
const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;
type BeatProjector = (beat: number) => number;
function interpolateValue(
    first: AutomationPoint,
    second: AutomationPoint,
    beat: number,
    previous?: AutomationPoint,
    next?: AutomationPoint
): number {
    // Curve math is the shared evaluateAutomationCurve kernel
    // (#/utils/automationCurve) — the identical implementation the live apply
    // path (Automation `interpolateAutomationPointValue`) routes through.
    // Finding AU-1: the offline and live curve copies had drifted (`stairs`
    // clamping) with no cross-conformance gate. Do not reintroduce local curve
    // math here; the automation curve-conformance specs guard re-divergence.
    return evaluateAutomationCurve({
        firstPoint: first,
        secondPoint: second,
        beat,
        previousPoint: previous,
        nextPoint: next,
    });
}

function beatAtTime(firstBeat: number, secondBeat: number, time: number, projectBeat: BeatProjector): number {
    if (time <= projectBeat(firstBeat)) {
        return firstBeat;
    }
    if (time >= projectBeat(secondBeat)) {
        return secondBeat;
    }
    let lower = firstBeat;
    let upper = secondBeat;
    for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (lower + upper) / 2;
        if (projectBeat(middle) < time) {
            lower = middle;
        } else {
            upper = middle;
        }
    }
    return (lower + upper) / 2;
}

function normalizePoints(points: AutomationPoint[]): AutomationPoint[] {
    const normalized: AutomationPoint[] = [];
    for (const point of [...points].sort((alpha, beta) => alpha.beat - beta.beat)) {
        if (normalized.at(-1)?.beat === point.beat) {
            normalized[normalized.length - 1] = point;
        } else {
            normalized.push(point);
        }
    }
    return normalized;
}

function appendEvent(events: CompiledAutomationEvent[], event: CompiledAutomationEvent): void {
    const previous = events.at(-1);
    if (previous?.type === event.type && previous.timeSeconds === event.timeSeconds && previous.value === event.value) {
        return;
    }
    events.push(event);
}

export function compileAutomationEvents(
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    regionStartSeconds = 0,
    projectBeatToSeconds?: BeatProjector
): CompiledAutomationEvent[] {
    if (points.length === 0 || durationSeconds < 0) {
        return [];
    }

    const projectBeat = projectBeatToSeconds ?? ((beat) => beatToSeconds(beat, defaultTempo, changes));
    const normalized = normalizePoints(points);
    const timed = normalized.map((point) => ({ point, time: projectBeat(point.beat) }));
    const regionEndSeconds = regionStartSeconds + durationSeconds;
    let initialValue = timed[0]!.point.value;

    for (let index = 0; index < timed.length - 1; index++) {
        const current = timed[index]!;
        const next = timed[index + 1]!;
        if (regionStartSeconds >= next.time) {
            initialValue = next.point.value;
            continue;
        }
        if (regionStartSeconds >= current.time) {
            const beat = beatAtTime(current.point.beat, next.point.beat, regionStartSeconds, projectBeat);
            initialValue = interpolateValue(
                current.point,
                next.point,
                beat,
                timed[index - 1]?.point,
                timed[index + 2]?.point
            );
        }
        break;
    }

    const events: CompiledAutomationEvent[] = [{ type: 'set', timeSeconds: 0, value: initialValue }];
    for (let index = 0; index < timed.length - 1; index++) {
        const current = timed[index]!;
        const next = timed[index + 1]!;
        if (next.time < regionStartSeconds) {
            continue;
        }
        if (current.time > regionEndSeconds) {
            break;
        }

        const visibleStart = Math.max(current.time, regionStartSeconds);
        const visibleEnd = Math.min(next.time, regionEndSeconds);
        if (visibleEnd < visibleStart) {
            continue;
        }
        const relativeStart = visibleStart - regionStartSeconds;
        const visibleStartBeat = beatAtTime(current.point.beat, next.point.beat, visibleStart, projectBeat);
        const visibleEndBeat = beatAtTime(current.point.beat, next.point.beat, visibleEnd, projectBeat);
        const startValue = interpolateValue(
            current.point,
            next.point,
            visibleStartBeat,
            timed[index - 1]?.point,
            timed[index + 2]?.point
        );
        appendEvent(events, { type: 'set', timeSeconds: relativeStart, value: startValue });

        if (current.point.curve === 'step') {
            if (next.time <= regionEndSeconds) {
                appendEvent(events, {
                    type: 'set',
                    timeSeconds: next.time - regionStartSeconds,
                    value: next.point.value,
                });
            }
            continue;
        }

        if (current.point.curve === 'stairs') {
            const stairSteps = clampStairSteps(current.point.stairSteps);
            for (let stair = 1; stair <= stairSteps; stair++) {
                const beat = current.point.beat + ((next.point.beat - current.point.beat) * stair) / stairSteps;
                const time = projectBeat(beat);
                if (time >= visibleStart && time <= visibleEnd) {
                    const value = current.point.value + ((next.point.value - current.point.value) * stair) / stairSteps;
                    appendEvent(events, { type: 'set', timeSeconds: time - regionStartSeconds, value });
                }
            }
            continue;
        }

        const beatSpan = visibleEndBeat - visibleStartBeat;
        const timeSpan = visibleEnd - visibleStart;
        const hasTempoBoundary = changes.some(
            (change) => change.beat > visibleStartBeat && change.beat < visibleEndBeat
        );
        const hasLinearTimeProjection =
            !hasTempoBoundary &&
            Math.abs(projectBeat(visibleStartBeat + beatSpan / 4) - (visibleStart + timeSpan / 4)) < 1e-4 &&
            Math.abs(projectBeat(visibleStartBeat + beatSpan / 2) - (visibleStart + timeSpan / 2)) < 1e-4;
        const steps =
            current.point.curve === 'linear' && hasLinearTimeProjection
                ? 1
                : Math.max(1, Math.ceil(timeSpan / AUTOMATION_SAMPLE_INTERVAL_SEC));
        for (let step = 1; step <= steps; step++) {
            const time = visibleStart + ((visibleEnd - visibleStart) * step) / steps;
            const beat = beatAtTime(visibleStartBeat, visibleEndBeat, time, projectBeat);
            appendEvent(events, {
                type: 'linear',
                timeSeconds: time - regionStartSeconds,
                value: interpolateValue(
                    current.point,
                    next.point,
                    beat,
                    timed[index - 1]?.point,
                    timed[index + 2]?.point
                ),
            });
        }
    }
    return events;
}
