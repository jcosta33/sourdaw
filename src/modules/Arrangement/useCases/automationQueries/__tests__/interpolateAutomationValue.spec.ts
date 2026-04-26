import { describe, it, expect } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { interpolateAutomationValue as interpolateFromTransformers } from '../../../transformers/automationTransformers';
import { interpolateAutomationValue } from '../interpolateAutomationValue';

function pt(beat: number, value: number, curve: AutomationPoint['curve'] = 'linear', tension = 0): AutomationPoint {
    return { beat, value, curve, tension };
}

describe('interpolateAutomationValue (public automationQueries export)', () => {
    it('should match the transformer implementation for linear interpolation', () => {
        const alpha = pt(0, 0);
        const buffer = pt(4, 1);
        expect(interpolateAutomationValue(alpha, buffer, 2)).toBe(interpolateFromTransformers(alpha, buffer, 2));
    });

    it('should match the transformer for coincident beats', () => {
        const param = pt(2, 0.25);
        expect(interpolateAutomationValue(param, { ...param, value: 0.75 }, 2)).toBe(
            interpolateFromTransformers(param, { ...param, value: 0.75 }, 2)
        );
    });
});
