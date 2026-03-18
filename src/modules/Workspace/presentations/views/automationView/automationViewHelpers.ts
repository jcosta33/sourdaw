import { type AutomationPoint } from '../../../useCases/workspaceViewActions';
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
 * Generate SVG path for automation curve between two adjacent points.
 */
export const buildCurvePath = (
    p1: AutomationPoint,
    p2: AutomationPoint,
    beatToX: (beat: number) => number,
    valueToY: (value: number) => number
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

    const tension = p1.tension ?? 0.5;
    const dx = x2 - x1;

    if (p1.curve === 's-curve') {
        const cp1x = x1 + dx * tension;
        const cp1y = y1;
        const cp2x = x2 - dx * tension;
        const cp2y = y2;
        return `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
    }

    // Exponential
    const cp1x = x1 + dx * 0.1;
    const cp1y = y1;
    const cp2x = x1 + dx * (0.3 + tension * 0.4);
    const cp2y = y2;
    return `C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`;
};
