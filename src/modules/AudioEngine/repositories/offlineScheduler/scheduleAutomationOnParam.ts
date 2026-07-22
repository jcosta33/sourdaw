import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

// ── Curve evaluation ─────────────────────────────────────────────────────
// Local replica of Automation's interpolateAutomationValue semantics
// (AGENTS.md §95 — model isolation; Automation's services are not a
// cross-module contract barrel). Playback renders every one of these
// shapes; exports must match instead of flattening to linear (M-039).

function cubicBezier(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const mt = 1 - t;
    return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function cubicBezierDeriv(p0: number, p1: number, p2: number, p3: number, t: number): number {
    const mt = 1 - t;
    return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
}

export function interpolateCurveValue(
    firstPoint: AutomationPoint,
    secondPoint: AutomationPoint,
    beat: number,
    previousPoint?: AutomationPoint,
    nextPoint?: AutomationPoint
): number {
    if (secondPoint.beat === firstPoint.beat) {
        return firstPoint.value;
    }
    if (firstPoint.curve === 'step') {
        return firstPoint.value;
    }

    const t = (beat - firstPoint.beat) / (secondPoint.beat - firstPoint.beat);
    const v1 = firstPoint.value;
    const v2 = secondPoint.value;

    if (firstPoint.curve === 'stairs') {
        const steps = firstPoint.stairSteps ?? 4;
        const steppedT = Math.floor(t * steps) / steps;
        return v1 + (v2 - v1) * steppedT;
    }

    if (firstPoint.curve === 'exponential') {
        const tension = firstPoint.tension;
        const expT = Math.abs(tension) < 0.01 ? t : t ** 2 ** (tension * 3);
        return v1 + (v2 - v1) * expT;
    }

    if (firstPoint.curve === 's-curve') {
        const tension = firstPoint.tension;
        const st = t * t * (3 - 2 * t);
        const curved = t + (st - t) * Math.abs(tension);
        return v1 + (v2 - v1) * curved;
    }

    if (firstPoint.curve === 'smooth') {
        const v0 = previousPoint?.value ?? v1;
        const v3 = nextPoint?.value ?? v2;
        const t2 = t * t;
        const t3 = t2 * t;
        return 0.5 * (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
    }

    if (firstPoint.curve === 'bezier') {
        // Cubic Bézier whose x control points are fractions of the segment
        // span (defaults 0.33/0.66, matching the renderer) and whose y
        // control points default to the segment endpoints. Solve x(s) === t
        // with fixed-iteration Newton steps, then evaluate y(s).
        const cx1 = firstPoint.cp1?.x ?? 0.33;
        const cx2 = firstPoint.cp2?.x ?? 0.66;
        const cy1 = firstPoint.cp1?.y ?? v1;
        const cy2 = firstPoint.cp2?.y ?? v2;

        let s = t;
        for (let iter = 0; iter < 6; iter++) {
            const xs = cubicBezier(0, cx1, cx2, 1, s) - t;
            if (Math.abs(xs) < 1e-6) {
                break;
            }
            const dx = cubicBezierDeriv(0, cx1, cx2, 1, s);
            if (Math.abs(dx) < 1e-9) {
                break;
            }
            s -= xs / dx;
            if (s < 0) {
                s = 0;
            } else if (s > 1) {
                s = 1;
            }
        }

        return cubicBezier(v1, cy1, cy2, v2, s);
    }

    return v1 + (v2 - v1) * t;
}

const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;

export function scheduleAutomationOnParam(
    param: AudioParam,
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    regionStartBeat = 0,
    compensationDelaySec = 0
): void {
    if (points.length === 0) {
        return;
    }

    const sorted = [...points].sort((alpha, b) => alpha.beat - b.beat);

    // Clip scheduling shifts audio by -regionStartSec and adds the track's
    // latency compensation; automation must apply the same corrections or
    // it lands offset against the audio it shapes (M-038).
    function timeForBeat(beat: number): number {
        return Math.max(0, beatToSeconds(beat - regionStartBeat, defaultTempo, changes) + compensationDelaySec);
    }

    // Seed with the value at the region start — the first point's value is
    // only correct when the region starts at or before it.
    const first = sorted[0]!;
    const last = sorted[sorted.length - 1]!;
    let initialValue: number;
    if (regionStartBeat <= first.beat) {
        initialValue = first.value;
    } else if (regionStartBeat >= last.beat) {
        initialValue = last.value;
    } else {
        const segmentIndex = sorted.findIndex((entry, index) => {
            const nextEntry = sorted[index + 1];
            return nextEntry !== undefined && entry.beat <= regionStartBeat && regionStartBeat < nextEntry.beat;
        });
        initialValue =
            segmentIndex >= 0
                ? interpolateCurveValue(
                      sorted[segmentIndex]!,
                      sorted[segmentIndex + 1]!,
                      regionStartBeat,
                      sorted[segmentIndex - 1],
                      sorted[segmentIndex + 2]
                  )
                : last.value;
    }
    param.setValueAtTime(initialValue, 0);

    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index]!;
        const next = sorted[index + 1];
        const currentTime = timeForBeat(current.beat);

        if (currentTime > durationSeconds) {
            break;
        }

        // Pre-region points inform the seed and interpolation context but
        // must not schedule their own events (they would overwrite the
        // region-start seed at clamped time 0).
        if (current.beat >= regionStartBeat) {
            param.setValueAtTime(current.value, currentTime);
        }

        if (!next) {
            break;
        }

        const nextTime = timeForBeat(next.beat);

        if (current.curve === 'step') {
            // A step hold from a pre-region segment would land at clamped
            // time 0 and clobber the region-start seed (measured: export
            // held 0.1 where live holds 0.9 past the lane's end).
            if (next.beat > regionStartBeat) {
                param.setValueAtTime(current.value, Math.max(0, nextTime - 0.0001));
            }
        } else if (current.curve === 'linear') {
            param.linearRampToValueAtTime(next.value, Math.min(nextTime, durationSeconds));
        } else {
            // Sampled rendering for shaped curves (smooth, s-curve, stairs,
            // bezier, exponential) using the same semantics as playback.
            const segmentBeats = next.beat - current.beat;
            const steps = Math.max(
                2,
                Math.ceil(Math.max(0.001, (nextTime - currentTime) / AUTOMATION_SAMPLE_INTERVAL_SEC))
            );
            for (let state = 1; state <= steps; state++) {
                const fraction = state / steps;
                const sampleBeat = current.beat + segmentBeats * fraction;
                if (sampleBeat < regionStartBeat) {
                    continue;
                }
                const sampleTime = timeForBeat(sampleBeat);
                if (sampleTime > durationSeconds) {
                    break;
                }
                const value = interpolateCurveValue(current, next, sampleBeat, sorted[index - 1], sorted[index + 2]);
                param.linearRampToValueAtTime(value, sampleTime);
            }
        }
    }
}
