import { describe, it, expect } from 'vitest';

import { type AutomationPoint } from '../../../models/AutomationViewTypes';
import { rdpSimplify as rdpFromTransformers } from '../../../transformers/automationTransformers';
import { rdpSimplify } from '../rdpSimplify';

function pt(beat: number, value: number): AutomationPoint {
    return { beat, value, curve: 'linear', tension: 0 };
}

describe('rdpSimplify (public automationQueries export)', () => {
    it('should match the transformer implementation for the same tolerance', () => {
        const pts = [pt(0, 0), pt(0.5, 0.5), pt(1, 1)];
        expect(rdpSimplify(pts, 0.05)).toEqual(rdpFromTransformers(pts, 0.05));
    });
});
