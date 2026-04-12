import { describe, expect, it } from 'vitest';

import {
    AUTOMATION_MODE_CONFIG,
    LANE_HEIGHT,
    buildCurvePath,
} from '../automationViewHelpers';
import { type AutomationPoint } from '../../../models/AutomationViewTypes';

const beatToX = (beat: number): number => beat * 10;
const valueToY = (value: number): number => 100 - value * 100;

function pt(
    beat: number,
    value: number,
    curve: AutomationPoint['curve'],
    tension = 0,
    stairSteps?: number
): AutomationPoint {
    return stairSteps !== undefined ? { beat, value, curve, tension, stairSteps } : { beat, value, curve, tension };
}

describe('LANE_HEIGHT', () => {
    it('should use a fixed lane height for automation lanes', () => {
        expect(LANE_HEIGHT).toBe(100);
    });
});

describe('AUTOMATION_MODE_CONFIG', () => {
    it('should define display metadata for every automation mode', () => {
        expect(AUTOMATION_MODE_CONFIG.off.label).toBe('OFF');
        expect(AUTOMATION_MODE_CONFIG.read.label).toBe('R');
        expect(AUTOMATION_MODE_CONFIG.touch.label).toBe('TCH');
        expect(AUTOMATION_MODE_CONFIG.latch.label).toBe('LCH');
        expect(AUTOMATION_MODE_CONFIG.write.label).toBe('W');
    });
});

describe('buildCurvePath', () => {
    it('should emit a straight segment for linear curves', () => {
        const p1 = pt(0, 0, 'linear');
        const p2 = pt(1, 1, 'linear');
        const path = buildCurvePath(p1, p2, beatToX, valueToY);
        expect(path).toBe('L 10 0');
    });

    it('should use a horizontal-then-vertical polyline for step curves', () => {
        const p1 = pt(0, 0.2, 'step');
        const p2 = pt(1, 0.8, 'step');
        const path = buildCurvePath(p1, p2, beatToX, valueToY);
        expect(path).toBe('L 10 80 L 10 20');
    });

    it('should subdivide stairs into stepped segments', () => {
        const p1 = pt(0, 0, 'stairs', 0, 2);
        const p2 = pt(1, 1, 'stairs', 0, 2);
        const path = buildCurvePath(p1, p2, beatToX, valueToY);
        expect(path.length).toBeGreaterThan(0);
        expect(path.startsWith('L')).toBe(true);
    });
});
