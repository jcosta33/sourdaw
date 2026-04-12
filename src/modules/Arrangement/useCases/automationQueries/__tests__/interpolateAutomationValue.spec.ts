import { describe, it, expect } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { interpolateAutomationValue as interpolateFromTransformers } from '../../../transformers/automationTransformers';
import { interpolateAutomationValue } from '../interpolateAutomationValue';

function pt(
    beat: number,
    value: number,
    curve: AutomationPoint['curve'] = 'linear',
    tension = 0
): AutomationPoint {
    return { beat, value, curve, tension };
}

describe('interpolateAutomationValue (public automationQueries export)', () => {
    it('should match the transformer implementation for linear interpolation', () => {
        const a = pt(0, 0);
        const b = pt(4, 1);
        expect(interpolateAutomationValue(a, b, 2)).toBe(interpolateFromTransformers(a, b, 2));
    });

    it('should match the transformer for coincident beats', () => {
        const p = pt(2, 0.25);
        expect(interpolateAutomationValue(p, { ...p, value: 0.75 }, 2)).toBe(
            interpolateFromTransformers(p, { ...p, value: 0.75 }, 2)
        );
    });
});
