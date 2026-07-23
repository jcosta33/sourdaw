import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';
type AutomationTempoChange = { beat: number; tempo: number };
export type CompiledAutomationEvent = { type: 'set' | 'linear'; timeSeconds: number; value: number };
const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;
type BeatProjector = (beat: number) => number;
function cubicBezier(a: number, b: number, c: number, d: number, value: number): number {
    const inverse = 1 - value;
    return inverse ** 3 * a + 3 * inverse ** 2 * value * b + 3 * inverse * value ** 2 * c + value ** 3 * d;
}

function cubicBezierDerivative(a: number, b: number, c: number, d: number, value: number): number {
    const inverse = 1 - value;
    return 3 * inverse * inverse * (b - a) + 6 * inverse * value * (c - b) + 3 * value * value * (d - c);
}

function interpolateValue(
    first: AutomationPoint,
    second: AutomationPoint,
    beat: number,
    previous?: AutomationPoint,
    next?: AutomationPoint
): number {
    if (first.curve === 'step' || second.beat <= first.beat) {
        return first.value;
    }
    const fraction = Math.min(1, Math.max(0, (beat - first.beat) / (second.beat - first.beat)));
    if (first.curve === 'stairs') {
        const stairSteps = Math.min(32, Math.max(2, Math.trunc(first.stairSteps ?? 4)));
        const stepped = Math.floor(fraction * stairSteps) / stairSteps;
        return first.value + (second.value - first.value) * stepped;
    }
    if (first.curve === 'exponential') {
        const power = Math.abs(first.tension) < 0.01 ? 1 : 2 ** (first.tension * 3);
        return first.value + (second.value - first.value) * fraction ** power;
    }
    if (first.curve === 's-curve') {
        const smooth = fraction * fraction * (3 - 2 * fraction);
        const curved = fraction + (smooth - fraction) * Math.abs(first.tension ?? 0.5);
        return first.value + (second.value - first.value) * curved;
    }
    if (first.curve === 'smooth') {
        const v0 = previous?.value ?? first.value;
        const v1 = first.value;
        const v2 = second.value;
        const v3 = next?.value ?? second.value;
        const squared = fraction * fraction;
        const cubed = squared * fraction;
        return (
            0.5 *
            (2 * v1 +
                (-v0 + v2) * fraction +
                (2 * v0 - 5 * v1 + 4 * v2 - v3) * squared +
                (-v0 + 3 * v1 - 3 * v2 + v3) * cubed)
        );
    }
    if (first.curve === 'bezier') {
        const x1 = first.cp1?.x ?? 0.33;
        const x2 = first.cp2?.x ?? 0.66;
        let parameter = fraction;
        for (let iteration = 0; iteration < 6; iteration++) {
            const delta = cubicBezier(0, x1, x2, 1, parameter) - fraction;
            const derivative = cubicBezierDerivative(0, x1, x2, 1, parameter);
            if (Math.abs(delta) < 1e-6 || Math.abs(derivative) < 1e-9) {
                break;
            }
            parameter = Math.min(1, Math.max(0, parameter - delta / derivative));
        }
        return cubicBezier(
            first.value,
            first.cp1?.y ?? first.value,
            first.cp2?.y ?? second.value,
            second.value,
            parameter
        );
    }
    return first.value + (second.value - first.value) * fraction;
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
            const stairSteps = Math.min(32, Math.max(2, Math.trunc(current.point.stairSteps ?? 4)));
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
