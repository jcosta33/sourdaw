import { trackStore } from '#/modules/Arrangement/stores';
import { getAutomationDeviceDescriptor } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';
import {
    createDeviceAutomationTargetId,
    getDeviceAutomationParameterId,
    resolveDeviceAutomationTargetIndex,
} from '#/utils/automationDeviceTarget';

import { type AutomationPoint } from '../../models/AutomationViewTypes';

export const LANE_HEIGHT = 100;

export const getAutomatableParams = (
    trackId: string,
    devices: { id?: string; type: string; name: string }[],
    lanes?: readonly { trackId?: string; clipId?: string; parameterId: string }[]
): { id: string; name: string; min: number; max: number }[] => {
    const params: { id: string; name: string; min: number; max: number }[] = [
        // The fader's real ceiling, and the same one `addAutomationLane` writes
        // into a new gain lane. Both of this helper's callers currently read only
        // `id` and `name`, so the range is inert — but a stale `1` sitting in a
        // structure named for parameter ranges hands the next reader who wires it
        // up a unity lane on a fader with `+6 dB` of headroom.
        { id: 'gain', name: 'Volume', min: 0, max: FADER_MAX_GAIN },
        { id: 'pan', name: 'Pan', min: -1, max: 1 },
    ];

    const trackDevices = trackStore.value?.tracks.find((track) => track.id === trackId)?.devices ?? [];
    for (let index = 0; index < devices.length; index++) {
        const device = devices[index]!;
        const deviceId = device.id ?? trackDevices[index]?.id;
        if (!deviceId) {
            continue;
        }
        const plugin = getAutomationDeviceDescriptor(device.type);
        if (!plugin) {
            continue;
        }
        for (const param of plugin.parameters) {
            if (param.automatable) {
                params.push({
                    id: createDeviceAutomationTargetId(deviceId, param.id),
                    name: `${device.name} → ${param.name}`,
                    min: param.minValue,
                    max: param.maxValue,
                });
            }
        }
    }

    const trackLanes = (lanes ?? automationStore.value?.lanes ?? []).filter(
        (lane) => (lane.trackId === undefined || lane.trackId === trackId) && !lane.clipId
    );
    return params.filter((param) => {
        const exactLane = trackLanes.some((lane) => lane.parameterId === param.id);
        if (exactLane || param.id === 'gain' || param.id === 'pan') {
            return !exactLane;
        }
        return !findEquivalentAutomationLane(param.id, trackLanes, devices, trackId);
    });
};

type AutomationTargetDevice = { id?: string; type: string; parameterValues?: Record<string, number> };

function acceptsAutomationParameter(device: AutomationTargetDevice, parameterId: string): boolean {
    if (device.parameterValues?.[parameterId] !== undefined) {
        return true;
    }
    const plugin = getAutomationDeviceDescriptor(device.type);
    return plugin?.parameters.some((parameter) => parameter.id === parameterId && parameter.automatable) ?? false;
}

export function findEquivalentAutomationLane<Lane extends { parameterId: string }>(
    targetId: string,
    lanes: readonly Lane[],
    devices: readonly AutomationTargetDevice[],
    trackId?: string
): Lane | undefined {
    const storedDevices = trackStore.value?.tracks.find((track) => track.id === trackId)?.devices ?? [];
    const candidates = devices.flatMap((device, index) => {
        const storedDevice = storedDevices[index];
        const id = device.id ?? (storedDevice?.type === device.type ? storedDevice.id : null);
        return id ? [{ ...device, id }] : [];
    });
    const targetIndex = resolveDeviceAutomationTargetIndex(targetId, candidates, acceptsAutomationParameter);
    const targetParameterId = getDeviceAutomationParameterId(targetId);
    if (targetIndex < 0 || !targetParameterId) {
        return undefined;
    }
    return lanes.find((lane) => {
        if (lane.parameterId === 'gain' || lane.parameterId === 'pan') {
            return false;
        }
        const laneIndex = resolveDeviceAutomationTargetIndex(lane.parameterId, candidates, acceptsAutomationParameter);
        return laneIndex === targetIndex && getDeviceAutomationParameterId(lane.parameterId) === targetParameterId;
    });
}

/**
 * Apply tension to a normalized t value using power curve.
 */
function applyTension(time: number, tension: number): number {
    if (Math.abs(tension) < 0.01) {
        return time;
    }
    const power = 2 ** (tension * 3);
    return Math.max(0, Math.min(1, time)) ** power;
}

/**
 * Generate SVG path for automation curve between two adjacent points.
 * Supports all six curve types: linear, step, exponential, s-curve, stairs, smooth.
 */
export const buildCurvePath = (
    p1: AutomationPoint,
    p2: AutomationPoint,
    beatToX: (beat: number) => number,
    valueToY: (value: number) => number,
    prevPoint?: AutomationPoint,
    nextPoint?: AutomationPoint
): string => {
    const x1 = beatToX(p1.beat);
    const y1 = valueToY(p1.value);
    const x2 = beatToX(p2.beat);
    const y2 = valueToY(p2.value);

    if (p1.curve === 'step') {
        return `L ${x2} ${y1} L ${x2} ${y2}`;
    }

    if (p1.curve === 'linear') {
        return `L ${x2} ${y2}`;
    }

    if (p1.curve === 'stairs') {
        const steps = p1.stairSteps ?? 4;
        let path = '';
        for (let state = 0; state < steps; state++) {
            const t1 = state / steps;
            const t2 = (state + 1) / steps;
            const stepValue = p1.value + (p2.value - p1.value) * t1;
            const sx1 = x1 + (x2 - x1) * t1;
            const sx2 = x1 + (x2 - x1) * t2;
            const sy = valueToY(stepValue);
            const nextStepValue = p1.value + (p2.value - p1.value) * t2;
            const nextSy = valueToY(nextStepValue);
            path += `L ${sx1} ${sy} L ${sx2} ${sy}`;
            if (state < steps - 1) {
                path += ` L ${sx2} ${nextSy}`;
            }
        }
        path += ` L ${x2} ${y2}`;
        return path;
    }

    if (p1.curve === 'smooth') {
        // Catmull-Rom spline — subdivide into line segments
        const v0 = prevPoint?.value ?? p1.value;
        const v1 = p1.value;
        const v2 = p2.value;
        const v3 = nextPoint?.value ?? p2.value;

        const segments = 20;
        let path = '';
        for (let index = 1; index <= segments; index++) {
            const time = index / segments;
            const t2 = time * time;
            const t3 = t2 * time;
            const interpValue =
                0.5 *
                (2 * v1 + (-v0 + v2) * time + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
            const sx = x1 + (x2 - x1) * time;
            const sy = valueToY(interpValue);
            path += `L ${sx} ${sy}`;
        }
        return path;
    }

    if (p1.curve === 'bezier') {
        const dx = x2 - x1;
        const cp1x = x1 + (p1.cp1?.x ?? 0.33) * dx;
        const cp1y = p1.cp1?.y !== undefined ? valueToY(p1.cp1.y) : y1;
        const cp2x = x1 + (p1.cp2?.x ?? 0.66) * dx;
        const cp2y = p1.cp2?.y !== undefined ? valueToY(p1.cp2.y) : y2;
        return `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
    }

    // Exponential with tension
    if (p1.curve === 'exponential') {
        const tension = p1.tension ?? 0;
        const segments = 16;
        let path = '';
        for (let index = 1; index <= segments; index++) {
            const time = index / segments;
            const curved = applyTension(time, tension);
            const sx = x1 + (x2 - x1) * time;
            const sy = valueToY(p1.value + (p2.value - p1.value) * curved);
            path += `L ${sx} ${sy}`;
        }
        return path;
    }

    // S-curve with tension
    const tension = p1.tension ?? 0.5;
    const dx = x2 - x1;
    const cp1x = x1 + dx * Math.abs(tension);
    const cp1y = y1;
    const cp2x = x2 - dx * Math.abs(tension);
    const cp2y = y2;
    return `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
};

/**
 * Automation mode display configuration.
 */
export const AUTOMATION_MODE_CONFIG = {
    off: { label: 'OFF', color: 'var(--color-text-disabled)', textColor: 'var(--color-text-tertiary)' },
    read: {
        label: 'R',
        color: 'var(--color-accent-mint)',
        textColor: 'color-mix(in oklch, var(--color-accent-mint) 70%, white)',
    },
    touch: {
        label: 'TCH',
        color: 'var(--color-accent-amber)',
        textColor: 'color-mix(in oklch, var(--color-accent-amber) 70%, white)',
    },
    latch: {
        label: 'LCH',
        color: 'var(--color-accent-peach)',
        textColor: 'color-mix(in oklch, var(--color-accent-peach) 70%, white)',
    },
    write: {
        label: 'W',
        color: 'var(--color-state-record)',
        textColor: 'color-mix(in oklch, var(--color-state-record) 70%, white)',
    },
} as const;
