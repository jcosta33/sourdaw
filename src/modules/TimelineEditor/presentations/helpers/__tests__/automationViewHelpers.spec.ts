import { describe, expect, it } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { AUTOMATION_MODE_CONFIG, LANE_HEIGHT, buildCurvePath, getAutomatableParams } from '../automationViewHelpers';

const beatToX = (beat: number): number => beat * 10;
const valueToY = (value: number): number => 100 - value * 100;
const device = (type: string, index = 1) => ({ id: `${type}-${index}`, type, name: type });
const levainLane = { parameterId: 'levain:masterGain' };
const levainTarget = 'levain-1:masterGain';

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

describe('getAutomatableParams', () => {
    it('should return the base volume and pan params when a track has no devices', () => {
        expect(getAutomatableParams('track-1', [])).toEqual([
            { id: 'gain', name: 'Volume', min: 0, max: FADER_MAX_GAIN },
            { id: 'pan', name: 'Pan', min: -1, max: 1 },
        ]);
    });

    it('should append only the automatable params of a known device, skipping non-automatable ones', () => {
        const params = getAutomatableParams('track-1', [{ id: 'levain-1', type: 'levain', name: 'Strings' }]);
        expect(params).toEqual([
            { id: 'gain', name: 'Volume', min: 0, max: FADER_MAX_GAIN },
            { id: 'pan', name: 'Pan', min: -1, max: 1 },
            { id: 'levain-1:masterGain', name: 'Strings → Master', min: 0, max: 2 },
            { id: 'levain-1:humanize', name: 'Strings → Humanize', min: 0, max: 1 },
            { id: 'levain-1:vibratoDepth', name: 'Strings → Vibrato', min: 0, max: 1 },
            { id: 'levain-1:legatoEnabled', name: 'Strings → Legato', min: 0, max: 1 },
        ]);
    });

    it('should ignore a device whose type does not match any built-in plugin', () => {
        const params = getAutomatableParams('track-1', [{ type: 'not-a-real-plugin', name: 'Mystery' }]);
        expect(params).toEqual([
            { id: 'gain', name: 'Volume', min: 0, max: FADER_MAX_GAIN },
            { id: 'pan', name: 'Pan', min: -1, max: 1 },
        ]);
    });

    it('exposes canonical targets for legacy device names and suppresses a bare equivalent lane', () => {
        const devices = [{ id: 'crumbs-1', type: 'cRuMbS', name: 'Sampler' }];

        const available = getAutomatableParams('track-1', devices);
        expect(available).toContainEqual(
            expect.objectContaining({ id: 'crumbs-1:masterGain', name: 'Sampler → Gain' })
        );

        const filtered = getAutomatableParams('track-1', devices, [{ parameterId: 'masterGain' }]);
        expect(filtered.some((param) => param.id === 'crumbs-1:masterGain')).toBe(false);
    });

    it.each([
        ['unique legacy', [device('levain')], [levainLane], levainTarget, false],
        ['ambiguous legacy', [device('levain'), device('levain', 2)], [levainLane], levainTarget, true],
        ['device gain', [device('grinder')], [{ parameterId: 'grinder-1:gain' }], 'gain', true],
        ['device pan', [device('crumbs')], [{ parameterId: 'crumbs-1:pan' }], 'pan', true],
        ['clip lane', [device('levain')], [{ ...levainLane, clipId: 'clip-1' }], levainTarget, true],
    ])('filters %s equivalence safely', (_name, devices, lanes, targetId, expected) => {
        const params = getAutomatableParams('track-1', devices, lanes);
        expect(params.some((param) => param.id === targetId)).toBe(expected);
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

    it('should interpolate a Catmull-Rom spline for smooth curves and honor neighbor context', () => {
        const p1 = pt(0, 0, 'smooth');
        const p2 = pt(1, 1, 'smooth');
        const withoutNeighbors = buildCurvePath(p1, p2, beatToX, valueToY);
        const withNeighbors = buildCurvePath(p1, p2, beatToX, valueToY, pt(-1, -1, 'smooth'), pt(2, 2, 'smooth'));

        expect(withoutNeighbors.match(/L /g)).toHaveLength(20);
        expect(withoutNeighbors.endsWith('L 10 0')).toBe(true);
        expect(withNeighbors.endsWith('L 10 0')).toBe(true);
        expect(withNeighbors).not.toBe(withoutNeighbors);
    });

    it('should build a default cubic bezier when no control points are given', () => {
        const p1 = pt(0, 0, 'bezier');
        const p2 = pt(1, 1, 'bezier');
        const path = buildCurvePath(p1, p2, beatToX, valueToY);
        expect(path).toBe(`C ${0 + 0.33 * 10} 100, ${0 + 0.66 * 10} 0, 10 0`);
    });

    it('should honor explicit bezier control points', () => {
        const p1: AutomationPoint = {
            beat: 0,
            value: 0,
            curve: 'bezier',
            tension: 0,
            cp1: { x: 0.2, y: 0.5 },
            cp2: { x: 0.8, y: 0.5 },
        };
        const p2 = pt(1, 1, 'bezier');
        const path = buildCurvePath(p1, p2, beatToX, valueToY);
        expect(path).toBe('C 2 50, 8 50, 10 0');
    });

    it('should ease in with a power curve for exponential segments once tension moves away from zero', () => {
        const linear = buildCurvePath(pt(0, 0, 'exponential', 0), pt(1, 1, 'exponential', 0), beatToX, valueToY);
        const bent = buildCurvePath(pt(0, 0, 'exponential', 0.5), pt(1, 1, 'exponential', 0.5), beatToX, valueToY);

        expect(linear.match(/L /g)).toHaveLength(16);
        expect(linear.endsWith('L 10 0')).toBe(true);
        expect(bent.endsWith('L 10 0')).toBe(true);
        expect(bent).not.toBe(linear);
    });

    it('should draw a symmetric ease curve for s-curve segments using tension', () => {
        const p1 = pt(0, 0, 's-curve', 0.3);
        const p2 = pt(1, 1, 's-curve', 0.3);
        const path = buildCurvePath(p1, p2, beatToX, valueToY);
        expect(path).toBe('C 3 100, 7 0, 10 0');
    });
});
