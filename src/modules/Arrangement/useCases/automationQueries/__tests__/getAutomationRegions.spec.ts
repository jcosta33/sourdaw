import { describe, it, expect } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { getAutomationRegions as getAutomationRegionsFromTransformers } from '../../../transformers/automationTransformers';
import { getAutomationRegions } from '../getAutomationRegions';

function pt(beat: number, value = 0): AutomationPoint {
    return { beat, value, curve: 'linear', tension: 0 };
}

describe('getAutomationRegions (public automationQueries export)', () => {
    it('should match the transformer implementation', () => {
        expect(getAutomationRegions([])).toEqual(getAutomationRegionsFromTransformers([]));
        const pts = [pt(0), pt(4)];
        expect(getAutomationRegions(pts)).toEqual(getAutomationRegionsFromTransformers(pts));
        expect(getAutomationRegions(pts, 1)).toEqual(getAutomationRegionsFromTransformers(pts, 1));
    });
});
