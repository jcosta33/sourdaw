import { type AutomationPoint } from '#/modules/Track/models/Automation';
import { BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';

export const LANE_HEIGHT = 100;

export const getAutomatableParams = (
    _trackId: string,
    devices: { type: string; name: string }[]
): { id: string; name: string; min: number; max: number }[] => {
    const params: { id: string; name: string; min: number; max: number }[] = [
        { id: 'gain', name: 'Volume', min: 0, max: 1 },
        { id: 'pan', name: 'Pan', min: -1, max: 1 },
    ];

    for (const device of devices) {
        const plugin = BUILTIN_PLUGINS.find((p) => p.id === device.type);
        if (!plugin) {
            continue;
        }
        for (const param of plugin.parameters) {
            if (param.automatable) {
                params.push({
                    id: `${device.type}:${param.id}`,
                    name: `${device.name} → ${param.name}`,
                    min: param.minValue,
                    max: param.maxValue,
                });
            }
        }
    }

    return params;
};

/**
 * Apply tension to a normalized t value using power curve.
 */
function applyTension(t: number, tension: number): number {
    if (Math.abs(tension) < 0.01) {
        return t;
    }
    const power = 2 ** (tension * 3);
    return Math.max(0, Math.min(1, t)) ** power;
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
        for (let s = 0; s < steps; s++) {
            const t1 = s / steps;
            const t2 = (s + 1) / steps;
            const stepValue = p1.value + (p2.value - p1.value) * t1;
            const sx1 = x1 + (x2 - x1) * t1;
            const sx2 = x1 + (x2 - x1) * t2;
            const sy = valueToY(stepValue);
            const nextStepValue = p1.value + (p2.value - p1.value) * t2;
            const nextSy = valueToY(nextStepValue);
            path += `L ${sx1} ${sy} L ${sx2} ${sy}`;
            if (s < steps - 1) {
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
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const t2 = t * t;
            const t3 = t2 * t;
            const interpValue =
                0.5 *
                (2 * v1 + (-v0 + v2) * t + (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 + (-v0 + 3 * v1 - 3 * v2 + v3) * t3);
            const sx = x1 + (x2 - x1) * t;
            const sy = valueToY(interpValue);
            path += `L ${sx} ${sy}`;
        }
        return path;
    }

    // Exponential with tension
    if (p1.curve === 'exponential') {
        const tension = p1.tension ?? 0;
        const segments = 16;
        let path = '';
        for (let i = 1; i <= segments; i++) {
            const t = i / segments;
            const curved = applyTension(t, tension);
            const sx = x1 + (x2 - x1) * t;
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
    off: { label: 'OFF', color: '#404040', textColor: '#737373' },
    read: { label: 'R', color: '#7db8a0', textColor: '#a0d4be' },
    touch: { label: 'TCH', color: '#c4aa5f', textColor: '#dcc88a' },
    latch: { label: 'LCH', color: '#c9a07a', textColor: '#e0c0a0' },
    write: { label: 'W', color: '#c45040', textColor: '#d88070' },
} as const;
