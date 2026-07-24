import { clampStairSteps, evaluateAutomationCurve } from '#/utils/automationCurve';
import { slewStep } from '#/utils/automationSlew';

import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';

type AutomationTempoChange = { beat: number; tempo: number };
export type CompiledAutomationEvent = { type: 'set' | 'linear'; timeSeconds: number; value: number };
const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;
// Slew settling tail bounds (AU-2): after the last point the offline slew keeps
// gliding to the held value so the render lands on the true target, not a
// mid-glide undershoot — matching the live path that keeps ticking past it.
const SLEW_SETTLE_EPSILON = 1e-6;
const MAX_SLEW_SETTLE_TICKS = 128;
type BeatProjector = (beat: number) => number;
type SlewConfig = { alpha: number; tickSeconds: number };
type ActiveWindowSeconds = { startSeconds: number; endSeconds: number };
export type CompileAutomationEventsOptions = {
    // Device-param control slew (AU-2). Omit for gain/pan — they are a-rate and
    // unslewed both live and offline.
    slew?: SlewConfig;
    // Restrict emission to a clip's active span, in project seconds (AU-12). The
    // event time origin stays the export region start; only visibility is cropped.
    activeWindowSeconds?: ActiveWindowSeconds;
};
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

function slewEvents(events: CompiledAutomationEvent[], { alpha, tickSeconds }: SlewConfig): CompiledAutomationEvent[] {
    if (events.length <= 1 || tickSeconds <= 0) {
        return events;
    }
    const startTime = events[0]!.timeSeconds;
    const endTime = events.at(-1)!.timeSeconds;
    if (endTime <= startTime) {
        return events;
    }
    // AU-2: replicate the live device-param slew offline. Resample the compiled
    // piecewise curve on the slew tick grid and run the identical one-pole IIR
    // (slewStep: y[n] = y[n-1] + alpha*(x[n]-y[n-1]), seeded y[0]=x[0]). The
    // compiled events already carry the true curve at <= tick resolution, so the
    // resampled x[n] equals what the live path reads and y[n] matches it
    // sample-for-sample. Emit the slewed samples as linear ramps.
    let cursor = 0;
    const sampleAt = (time: number): number => {
        while (cursor + 1 < events.length && events[cursor + 1]!.timeSeconds <= time) {
            cursor++;
        }
        const current = events[cursor]!;
        const next = events[cursor + 1];
        if (!next || next.type === 'set') {
            return current.value;
        }
        const span = next.timeSeconds - current.timeSeconds;
        if (span <= 0) {
            return next.value;
        }
        return current.value + (next.value - current.value) * ((time - current.timeSeconds) / span);
    };
    let smoothed = sampleAt(startTime);
    const slewed: CompiledAutomationEvent[] = [{ type: 'set', timeSeconds: startTime, value: smoothed }];
    const mainSamples = Math.ceil((endTime - startTime) / tickSeconds);
    for (let index = 1; index <= mainSamples; index++) {
        const time = Math.min(endTime, startTime + index * tickSeconds);
        smoothed = slewStep(smoothed, sampleAt(time), alpha);
        appendEvent(slewed, { type: 'linear', timeSeconds: time, value: smoothed });
    }
    // Settling tail: after the last point the curve holds its final value while
    // the live path keeps ticking, so the slew keeps gliding toward it. Without
    // this the param would be held at a mid-glide undershoot instead of the true
    // target. Continue past the last event until settled (bounded), then land
    // exactly on the target so WebAudio holds the correct value.
    const finalTarget = events.at(-1)!.value;
    let tick = mainSamples;
    for (
        let extra = 0;
        extra < MAX_SLEW_SETTLE_TICKS && Math.abs(smoothed - finalTarget) > SLEW_SETTLE_EPSILON;
        extra++
    ) {
        tick++;
        smoothed = slewStep(smoothed, finalTarget, alpha);
        appendEvent(slewed, { type: 'linear', timeSeconds: startTime + tick * tickSeconds, value: smoothed });
    }
    if (slewed.at(-1)!.value !== finalTarget) {
        appendEvent(slewed, { type: 'linear', timeSeconds: startTime + (tick + 1) * tickSeconds, value: finalTarget });
    }
    return slewed;
}

export function compileAutomationEvents(
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    regionStartSeconds = 0,
    projectBeatToSeconds?: BeatProjector,
    options?: CompileAutomationEventsOptions
): CompiledAutomationEvent[] {
    if (points.length === 0 || durationSeconds < 0) {
        return [];
    }

    const projectBeat = projectBeatToSeconds ?? ((beat) => beatToSeconds(beat, defaultTempo, changes));
    const normalized = normalizePoints(points);
    const timed = normalized.map((point) => ({ point, time: projectBeat(point.beat) }));
    const regionEndSeconds = regionStartSeconds + durationSeconds;
    // AU-12: a clip-scoped lane emits only within its clip span. Intersect the
    // clip window with the export region; the time origin stays regionStart so
    // emitted times remain relative to the export, matching clip audio.
    const windowStart = Math.max(
        regionStartSeconds,
        options?.activeWindowSeconds?.startSeconds ?? Number.NEGATIVE_INFINITY
    );
    const windowEnd = Math.min(regionEndSeconds, options?.activeWindowSeconds?.endSeconds ?? Number.POSITIVE_INFINITY);
    if (windowEnd < windowStart) {
        return [];
    }
    let initialValue = timed[0]!.point.value;

    for (let index = 0; index < timed.length - 1; index++) {
        const current = timed[index]!;
        const next = timed[index + 1]!;
        if (windowStart >= next.time) {
            initialValue = next.point.value;
            continue;
        }
        if (windowStart >= current.time) {
            const beat = beatAtTime(current.point.beat, next.point.beat, windowStart, projectBeat);
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

    const events: CompiledAutomationEvent[] = [
        { type: 'set', timeSeconds: windowStart - regionStartSeconds, value: initialValue },
    ];
    for (let index = 0; index < timed.length - 1; index++) {
        const current = timed[index]!;
        const next = timed[index + 1]!;
        if (next.time < windowStart) {
            continue;
        }
        if (current.time > windowEnd) {
            break;
        }

        const visibleStart = Math.max(current.time, windowStart);
        const visibleEnd = Math.min(next.time, windowEnd);
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
            if (next.time <= windowEnd) {
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
    if (options?.slew) {
        return slewEvents(events, options.slew);
    }
    return events;
}
