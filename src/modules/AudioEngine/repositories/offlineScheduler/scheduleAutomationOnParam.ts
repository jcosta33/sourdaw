import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';

import { interpolateCurveValue } from './interpolateCurveValue';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

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
