import { clampStairSteps, evaluateAutomationCurve } from '#/utils/automationCurve';
import { slewStep } from '#/utils/automationSlew';

import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';

type AutomationTempoChange = { beat: number; tempo: number };
export type CompiledAutomationEvent = { type: 'set' | 'linear'; timeSeconds: number; value: number };
const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;
// The offline slew, once past the last point, glides to the held target; below
// this residual it is treated as settled and the exact target is emitted so the
// render holds the true value (not a mid-glide undershoot).
const SLEW_SETTLE_EPSILON = 1e-6;
type BeatProjector = (beat: number) => number;
type SlewConfig = {
    alpha: number;
    tickSeconds: number;
    /**
     * Applied to every slewed sample, and fed back into the recurrence — the
     * position live puts the declared-range clamp in
     * (`applyAutomation`: `slewStep` → `clampDeviceParameterValue` →
     * `laneSlew.set(clamped)`). A clamp is not affine, so it does not commute
     * with the IIR: applying it to the target instead of to the smoothed value
     * renders a different curve. Omit for a lane with no declared range.
     */
    clampStep?: (value: number) => number;
    /**
     * Applied to every **emitted** sample and to nothing else — never fed back
     * into the recurrence, which is exactly where it differs from `clampStep`.
     *
     * This is the offline half of the live delivery law
     * (`applyAutomation`: `laneSlew.set(smoothed)` then
     * `updateDeviceParam(quantise(smoothed))`). A parameter the descriptor
     * declares `int`/`bool`/`choice` may only reach the DSP as an integer, but
     * rounding the filter's own state dead-zones it: at α = 0.4 `slewStep(5, 6)`
     * is 5.4, which rounds back to 5 for ever. Filter continuously, quantise on
     * the way out. Omit for a lane with no declared type (gain, pan, `float`).
     */
    quantiseEmit?: (value: number) => number;
};
type ActiveWindowSeconds = { startSeconds: number; endSeconds: number };
export type CompileAutomationEventsOptions = {
    // Device-param control slew (AU-2). Omit for gain/pan — they are a-rate and
    // unslewed both live and offline.
    slew?: SlewConfig;
    // Restrict emission to a clip's active span, in project seconds (AU-12). The
    // event time origin stays the export region start; only visibility is cropped.
    activeWindowSeconds?: ActiveWindowSeconds;
    /**
     * The point-holding lane's own declared range, applied to every
     * interpolated value BEFORE `valueScale`/`valueOffset` and before
     * `valueTransform`.
     *
     * That position is the whole of what this option is for, and it is the live
     * path's: `getAutomationValueAtBeat` runs `clampToLaneRange(interpolated,
     * lane, …)` and *then* multiplies by the resolved link scale, because
     * `minValue`/`maxValue` describe the source lane's own points rather than
     * the scaled result — a `linkScale: -1` lane may legitimately land outside
     * them. Folding this into `valueTransform` would bound the scaled value and
     * flatten exactly that case.
     *
     * Non-linear interpolation is why it is needed at all offline: 'smooth'
     * (Catmull-Rom) overshoots between control points by construction, and this
     * compiler samples such a segment at 10 ms through the same curve kernel the
     * monitor evaluates per tick. Without the bound the bounce prints the
     * overshoot the monitor clamped away. Omit for a lane with no declared range.
     */
    valueBound?: (value: number) => number;
    // Affine post-transform on the interpolated values: value → value*valueScale
    // + valueOffset. This is how the live path applies a linked lane's linkScale
    // (and any device binding scale/offset) — it scales the *resolved scalar*
    // once, AFTER interpolation, so a bezier segment's cp1.y/cp2.y shape is
    // evaluated unscaled and then scaled (AU-3). Applied before the slew; the IIR
    // is affine so the order does not change the result.
    valueScale?: number;
    valueOffset?: number;
    /**
     * Non-affine post-transform applied AFTER `valueScale`/`valueOffset` and
     * before the slew — for laws the affine pair cannot express, notably the
     * fader's dB→linear conversion and its `FADER_MAX_GAIN` ceiling. That
     * ceiling is the fader's `+6 dB` of headroom, not unity: it is the bound on
     * what the strip may reach, and it is a different question from the lane
     * bound `valueBound` applies, which is what the lane's own points declare.
     * Keep it pure; it runs once per compiled event.
     */
    valueTransform?: (value: number) => number;
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

function slewEvents(
    events: CompiledAutomationEvent[],
    { alpha, tickSeconds, clampStep, quantiseEmit }: SlewConfig,
    windowEndSeconds: number
): CompiledAutomationEvent[] {
    if (events.length <= 1 || tickSeconds <= 0) {
        return events;
    }
    const startTime = events[0]!.timeSeconds;
    const lastEventTime = events.at(-1)!.timeSeconds;
    // Slew across the curve and on to the active-window end — the live path keeps
    // ticking to the same boundary (region end for a track lane; clip end for a
    // clip lane, where it then skips the lane). After the last point the held
    // value is finalTarget, so x(t) is finalTarget in the tail.
    const endTime = Math.max(lastEventTime, windowEndSeconds);
    if (endTime <= startTime) {
        return events;
    }
    // AU-2: replicate the live device-param slew offline. Resample x(t) on the
    // slew tick grid and run the identical one-pole IIR (slewStep). The compiled
    // events already carry the true curve at <= tick resolution, so x[n] equals
    // what the live path reads and y[n] matches it sample-for-sample. Emit the
    // slewed samples as linear ramps.
    const clamp = clampStep ?? ((value: number) => value);
    const quantise = quantiseEmit ?? ((value: number) => value);
    const finalTarget = events.at(-1)!.value;
    // The value the glide can actually settle on. Live never dispatches past the
    // declared bound either, so an out-of-range tail settles at the bound.
    const settledTarget = clamp(finalTarget);
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
    // The live seed is `prev ?? value`, so its first tick emits `slewStep(value,
    // value)` = value and then clamps it. Clamp the seed here for the same reason.
    let smoothed = clamp(sampleAt(startTime));
    // `smoothed` is the filter state and stays continuous throughout; every
    // `value` written into `slewed` below goes through `quantise` instead.
    const slewed: CompiledAutomationEvent[] = [{ type: 'set', timeSeconds: startTime, value: quantise(smoothed) }];
    const sampleCount = Math.ceil((endTime - startTime) / tickSeconds);
    for (let index = 1; index <= sampleCount; index++) {
        const time = Math.min(endTime, startTime + index * tickSeconds);
        // Past the last point the curve holds finalTarget; before it, sample the
        // compiled curve.
        const target = time <= lastEventTime ? sampleAt(time) : finalTarget;
        smoothed = clamp(slewStep(smoothed, target, alpha));
        // Once settled past the last point the value is held: emit the exact
        // target and stop. WebAudio holds it, and the live path has settled too.
        // If the window ends first (short clip), the loop stops mid-glide and the
        // param holds that value — matching the live clip-bounds skip.
        // Settling is decided on the continuous pair, so a stepped lane still
        // stops the moment the *filter* has arrived rather than the moment two
        // consecutive rounded samples happen to agree.
        const settledHold = time > lastEventTime && Math.abs(smoothed - settledTarget) <= SLEW_SETTLE_EPSILON;
        appendEvent(slewed, {
            type: 'linear',
            timeSeconds: time,
            value: quantise(settledHold ? settledTarget : smoothed),
        });
        if (settledHold) {
            break;
        }
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
        // A non-linear curve (bezier, smooth, exponential, s-curve — or a
        // linear one crossing a tempo change) is pre-sampled into linear
        // segments. That grid has to be at least as fine as the slew tick, or
        // the slew resamples an already-coarser approximation: live evaluates
        // the true curve at every tick, so at a grain under this interval the
        // bounce would low-pass a stair-stepped input the monitor never saw.
        // Only tightened when a slew is actually configured — gain and pan are
        // a-rate and unslewed on both sides, and pay nothing for this.
        const sampleIntervalSec = Math.min(AUTOMATION_SAMPLE_INTERVAL_SEC, options?.slew?.tickSeconds ?? Infinity);
        const steps =
            current.point.curve === 'linear' && hasLinearTimeProjection
                ? 1
                : Math.max(1, Math.ceil(timeSpan / sampleIntervalSec));
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
    const valueBound = options?.valueBound;
    const valueScale = options?.valueScale ?? 1;
    const valueOffset = options?.valueOffset ?? 0;
    const valueTransform = options?.valueTransform;
    if (valueBound || valueScale !== 1 || valueOffset !== 0 || valueTransform) {
        for (const event of events) {
            // Lane range first, then the affine, then the law — the live order.
            const bounded = valueBound ? valueBound(event.value) : event.value;
            const scaled = bounded * valueScale + valueOffset;
            event.value = valueTransform ? valueTransform(scaled) : scaled;
        }
    }
    if (options?.slew) {
        return slewEvents(events, options.slew, windowEnd - regionStartSeconds);
    }
    return events;
}
