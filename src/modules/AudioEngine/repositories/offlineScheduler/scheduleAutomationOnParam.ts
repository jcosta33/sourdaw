import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

function interpolateValue(p1: AutomationPoint, p2: AutomationPoint, beat: number): number {
    if (p2.beat === p1.beat) {
        return p1.value;
    }
    if (p1.curve === 'step') {
        return p1.value;
    }
    const time = (beat - p1.beat) / (p2.beat - p1.beat);
    if (p1.curve === 'exponential') {
        return p1.value + (p2.value - p1.value) * time * time;
    }
    return p1.value + (p2.value - p1.value) * time;
}

const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;

export function scheduleAutomationOnParam(
    param: AudioParam,
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[]
): void {
    if (points.length === 0) {
        return;
    }

    const sorted = [...points].sort((alpha, b) => alpha.beat - b.beat);

    param.setValueAtTime(sorted[0]!.value, 0);

    for (let index = 0; index < sorted.length; index++) {
        const current = sorted[index]!;
        const next = sorted[index + 1];
        const currentTime = beatToSeconds(current.beat, defaultTempo, changes);

        if (currentTime > durationSeconds) {
            break;
        }

        param.setValueAtTime(current.value, Math.max(0, currentTime));

        if (!next) {
            break;
        }

        const nextTime = beatToSeconds(next.beat, defaultTempo, changes);

        if (current.curve === 'step') {
            param.setValueAtTime(current.value, Math.max(0, nextTime - 0.0001));
        } else if (current.curve === 'linear') {
            param.linearRampToValueAtTime(next.value, Math.min(nextTime, durationSeconds));
        } else {
            const steps = Math.max(2, Math.ceil((nextTime - currentTime) / AUTOMATION_SAMPLE_INTERVAL_SEC));
            for (let state = 1; state <= steps; state++) {
                const fraction = state / steps;
                const sampleBeat = current.beat + (next.beat - current.beat) * fraction;
                const sampleTime = beatToSeconds(sampleBeat, defaultTempo, changes);
                if (sampleTime > durationSeconds) {
                    break;
                }
                const value = interpolateValue(current, next, sampleBeat);
                param.linearRampToValueAtTime(value, sampleTime);
            }
        }
    }
}
