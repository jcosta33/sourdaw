import { getBuiltinPlugins } from '#/modules/Arrangement/useCases';

import { type AutomationPoint } from '../../models/AutomationViewTypes';

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
        const plugin = getBuiltinPlugins().find((p) => p.id === device.type);
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
