import { type AutomationPoint } from '../../models/AutomationViewTypes';
import { beatToSeconds } from '../../services/beatConversion';
import { type OfflineAutomationSegment } from '../deviceStrategy/AudioDeviceStrategy';

type AutomationTempoChange = {
    beat: number;
    tempo: number;
};

const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;

function toFrame(seconds: number, durationSeconds: number, sampleRate: number): number {
    return Math.round(Math.min(durationSeconds, Math.max(0, seconds)) * sampleRate);
}

function interpolateQuadratic(first: AutomationPoint, second: AutomationPoint, beat: number): number {
    if (second.beat === first.beat) {
        return second.value;
    }
    const fraction = (beat - first.beat) / (second.beat - first.beat);
    return first.value + (second.value - first.value) * fraction * fraction;
}

export function compileAutomationSegments(
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: AutomationTempoChange[],
    sampleRate: number,
    regionStartSeconds = 0
): OfflineAutomationSegment[] {
    if (points.length === 0 || durationSeconds < 0 || sampleRate <= 0) {
        return [];
    }

    const sorted = [...points].sort((alpha, beta) => alpha.beat - beta.beat);
    const segments: OfflineAutomationSegment[] = [];
    const first = sorted[0]!;
    const firstFrame = toFrame(
        beatToSeconds(first.beat, defaultTempo, changes) - regionStartSeconds,
        durationSeconds,
        sampleRate
    );
    if (firstFrame > 0) {
        segments.push({ startFrame: 0, endFrame: firstFrame, startValue: first.value, endValue: first.value });
    }

    for (let index = 0; index < sorted.length - 1; index++) {
        const current = sorted[index]!;
        const next = sorted[index + 1]!;
        const currentTime = beatToSeconds(current.beat, defaultTempo, changes) - regionStartSeconds;
        if (currentTime > durationSeconds) {
            break;
        }
        const nextTime = beatToSeconds(next.beat, defaultTempo, changes) - regionStartSeconds;
        const startFrame = toFrame(currentTime, durationSeconds, sampleRate);
        const endFrame = toFrame(nextTime, durationSeconds, sampleRate);

        if (current.curve === 'exponential' && endFrame > startFrame) {
            const steps = Math.max(2, Math.ceil((nextTime - currentTime) / AUTOMATION_SAMPLE_INTERVAL_SEC));
            let previousFrame = startFrame;
            let previousValue = current.value;
            for (let step = 1; step <= steps; step++) {
                const fraction = step / steps;
                const sampleBeat = current.beat + (next.beat - current.beat) * fraction;
                const sampleTime = beatToSeconds(sampleBeat, defaultTempo, changes) - regionStartSeconds;
                if (sampleTime > durationSeconds) {
                    break;
                }
                const sampleFrame = toFrame(sampleTime, durationSeconds, sampleRate);
                const sampleValue = interpolateQuadratic(current, next, sampleBeat);
                segments.push({
                    startFrame: previousFrame,
                    endFrame: sampleFrame,
                    startValue: previousValue,
                    endValue: sampleValue,
                });
                previousFrame = sampleFrame;
                previousValue = sampleValue;
            }
            continue;
        }

        const endValue = current.curve === 'step' ? current.value : next.value;
        segments.push({ startFrame, endFrame, startValue: current.value, endValue });
    }

    const last = sorted.at(-1)!;
    const lastTime = beatToSeconds(last.beat, defaultTempo, changes) - regionStartSeconds;
    if (lastTime <= durationSeconds) {
        const lastFrame = toFrame(lastTime, durationSeconds, sampleRate);
        segments.push({ startFrame: lastFrame, endFrame: lastFrame, startValue: last.value, endValue: last.value });
    }
    return segments;
}
