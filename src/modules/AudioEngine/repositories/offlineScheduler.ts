/**
 * Repository: scheduling helpers for offline audio rendering.
 * Resolves beat→time conversion, automation scheduling on AudioParams,
 * and device parameter resolution for offline render contexts.
 */

import { getTempoAtBeat, type TempoChange } from '#/modules/Transport/useCases/transportQueries';
import { type AutomationLane, type AutomationPoint } from '#/modules/Track/useCases/trackQueries';
import { type DeviceNodeEntry, type OfflineDeviceNode } from '../useCases/buildDeviceChain';
import { getDrumKitByIndex, type DrumKit } from '../useCases/drumKitSynth';

export function beatToSeconds(beat: number, defaultTempo: number, changes: TempoChange[]): number {
    if (changes.length === 0) {
        return (beat / defaultTempo) * 60;
    }

    const sorted = [...changes].sort((a, b) => a.beat - b.beat);
    let seconds = 0;
    let prevBeat = 0;
    let prevTempo = sorted[0]!.beat > 0 ? defaultTempo : sorted[0]!.tempo;

    for (const change of sorted) {
        if (change.beat >= beat) {
            break;
        }
        const segment = change.beat - prevBeat;
        seconds += (segment / prevTempo) * 60;
        prevBeat = change.beat;
        prevTempo = change.tempo;
    }

    seconds += ((beat - prevBeat) / getTempoAtBeat(sorted, beat, prevTempo)) * 60;
    return seconds;
}

export function resolveDrumKit(devices: { type: string; parameterValues: Record<string, number> }[]): DrumKit | null {
    const kitDevice = devices.find((d) => d.type === 'drum-kit');
    if (!kitDevice) {
        return null;
    }
    const kitIndex = kitDevice.parameterValues.kitId ?? 0;
    return getDrumKitByIndex(kitIndex);
}

export const resolveDeviceParam = (
    deviceType: string,
    parameterId: string,
    node: OfflineDeviceNode
): AudioParam | null => {
    const paramMap: Record<string, () => AudioParam | null> = {
        'builtin-eq:eq-low-gain': () => (node.nodes[0] as BiquadFilterNode | undefined)?.gain ?? null,
        'builtin-eq:eq-low-freq': () => (node.nodes[0] as BiquadFilterNode | undefined)?.frequency ?? null,
        'builtin-eq:eq-mid-gain': () => (node.nodes[1] as BiquadFilterNode | undefined)?.gain ?? null,
        'builtin-eq:eq-mid-freq': () => (node.nodes[1] as BiquadFilterNode | undefined)?.frequency ?? null,
        'builtin-eq:eq-mid-q': () => (node.nodes[1] as BiquadFilterNode | undefined)?.Q ?? null,
        'builtin-eq:eq-high-gain': () => (node.nodes[2] as BiquadFilterNode | undefined)?.gain ?? null,
        'builtin-eq:eq-high-freq': () => (node.nodes[2] as BiquadFilterNode | undefined)?.frequency ?? null,
        'builtin-compressor:comp-threshold': () =>
            (node.nodes[0] as DynamicsCompressorNode | undefined)?.threshold ?? null,
        'builtin-compressor:comp-ratio': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.ratio ?? null,
        'builtin-compressor:comp-attack': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.attack ?? null,
        'builtin-compressor:comp-release': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.release ?? null,
        'builtin-compressor:comp-makeup': () => (node.nodes[1] as GainNode | undefined)?.gain ?? null,
        'builtin-reverb:rev-mix': () => (node.nodes[2] as GainNode | undefined)?.gain ?? null,
        'builtin-delay:delay-time': () => (node.nodes[3] as DelayNode | undefined)?.delayTime ?? null,
        'builtin-delay:delay-feedback': () => (node.nodes[4] as GainNode | undefined)?.gain ?? null,
        'builtin-delay:delay-mix': () => (node.nodes[2] as GainNode | undefined)?.gain ?? null,
        'builtin-gain:gain-level': () => (node.nodes[0] as GainNode | undefined)?.gain ?? null,
        'builtin-limiter:lim-threshold': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.threshold ?? null,
        'builtin-limiter:lim-release': () => (node.nodes[0] as DynamicsCompressorNode | undefined)?.release ?? null,
        'builtin-limiter:lim-ceiling': () => (node.nodes[1] as GainNode | undefined)?.gain ?? null,
    };

    const resolver = paramMap[`${deviceType}:${parameterId}`];
    if (resolver) {
        return resolver();
    }
    return null;
};

function interpolateValue(p1: AutomationPoint, p2: AutomationPoint, beat: number): number {
    if (p2.beat === p1.beat) {
        return p1.value;
    }
    if (p1.curve === 'step') {
        return p1.value;
    }
    const t = (beat - p1.beat) / (p2.beat - p1.beat);
    if (p1.curve === 'exponential') {
        return p1.value + (p2.value - p1.value) * t * t;
    }
    return p1.value + (p2.value - p1.value) * t;
}

const AUTOMATION_SAMPLE_INTERVAL_SEC = 0.01;

export const scheduleAutomationOnParam = (
    param: AudioParam,
    points: AutomationPoint[],
    durationSeconds: number,
    defaultTempo: number,
    changes: TempoChange[]
): void => {
    if (points.length === 0) {
        return;
    }

    const sorted = [...points].sort((a, b) => a.beat - b.beat);

    param.setValueAtTime(sorted[0]!.value, 0);

    for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i]!;
        const next = sorted[i + 1];
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
            for (let s = 1; s <= steps; s++) {
                const fraction = s / steps;
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
};

export const scheduleTrackAutomation = (
    lanes: AutomationLane[],
    trackId: string,
    trackGainNode: GainNode,
    trackPanNode: StereoPannerNode,
    deviceEntries: DeviceNodeEntry[],
    durationSeconds: number,
    defaultTempo: number,
    changes: TempoChange[]
): void => {
    const trackLanes = lanes.filter((l) => l.trackId === trackId && !l.clipId);

    for (const lane of trackLanes) {
        if (lane.points.length === 0) {
            continue;
        }

        if (lane.parameterId === 'gain') {
            scheduleAutomationOnParam(trackGainNode.gain, lane.points, durationSeconds, defaultTempo, changes);
            continue;
        }

        if (lane.parameterId === 'pan') {
            scheduleAutomationOnParam(trackPanNode.pan, lane.points, durationSeconds, defaultTempo, changes);
            continue;
        }

        const deviceEntry = deviceEntries.find((e) => {
            const prefix = `${e.deviceId}:`;
            return lane.parameterId.startsWith(prefix);
        });
        if (deviceEntry) {
            const paramKey = lane.parameterId.slice(lane.parameterId.indexOf(':') + 1);
            const audioParam = resolveDeviceParam(deviceEntry.deviceType, paramKey, deviceEntry.node);
            if (audioParam) {
                scheduleAutomationOnParam(audioParam, lane.points, durationSeconds, defaultTempo, changes);
            }
            continue;
        }

        const directEntry = deviceEntries.find((e) => {
            return resolveDeviceParam(e.deviceType, lane.parameterId, e.node) !== null;
        });
        if (directEntry) {
            const audioParam = resolveDeviceParam(directEntry.deviceType, lane.parameterId, directEntry.node);
            if (audioParam) {
                scheduleAutomationOnParam(audioParam, lane.points, durationSeconds, defaultTempo, changes);
            }
        }
    }
};
