/**
 * Constants for the automation lane view — curve types, shape presets,
 * and shared coordinate conversion helpers.
 */
import { formatGainDb } from '#/utils/audioLevelLaw';

import { type AutomationCurveType } from '../../models/AutomationViewTypes';

type AutomationShapeType = 'sine' | 'triangle' | 'sawtooth-up' | 'sawtooth-down' | 'square' | 'random';

export const CURVE_OPTIONS: { value: AutomationCurveType; label: string }[] = [
    { value: 'linear', label: 'Linear' },
    { value: 's-curve', label: 'S-Curve (Smooth)' },
    { value: 'exponential', label: 'Exponential' },
    { value: 'step', label: 'Step (Hold)' },
    { value: 'stairs', label: 'Stairs' },
    { value: 'smooth', label: 'Smooth (Spline)' },
];

export const SHAPE_OPTIONS: { value: AutomationShapeType; label: string }[] = [
    { value: 'sine', label: '∿ Sine' },
    { value: 'triangle', label: '△ Triangle' },
    { value: 'sawtooth-up', label: '⟋ Sawtooth Up' },
    { value: 'sawtooth-down', label: '⟍ Sawtooth Down' },
    { value: 'square', label: '⊓ Square' },
    { value: 'random', label: '⚡ Random' },
];

/** Map curve type to single-char label for breakpoint nodes. */
export const curveLabel = (curve: AutomationCurveType): string => {
    switch (curve) {
        case 's-curve':
            return 'S';
        case 'exponential':
            return 'E';
        case 'step':
            return '⌐';
        case 'stairs':
            return '⊏';
        case 'smooth':
            return '~';
        case 'linear':
        case 'bezier':
        default:
            return '';
    }
};

/** Format a parameter value for display, handling gain/pan specially. */
export const formatParameterValue = (value: number, parameterId: string): string => {
    if (parameterId === 'gain') {
        return `${formatGainDb(value)} dB`;
    }
    if (parameterId === 'pan') {
        if (Math.abs(value) < 0.01) {
            return 'C';
        }
        return value > 0 ? `${(value * 100).toFixed(0)}R` : `${(-value * 100).toFixed(0)}L`;
    }
    return `${(value * 100).toFixed(0)}%`;
};
