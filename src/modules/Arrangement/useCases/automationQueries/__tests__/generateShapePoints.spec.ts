import { describe, it, expect } from 'vitest';

import { generateShapePoints as generateShapePointsFromTransformers } from '../../../transformers/automationTransformers';
import { generateShapePoints } from '../generateShapePoints';

describe('generateShapePoints (public automationQueries export)', () => {
    it('should match the transformer implementation', () => {
        const args = ['triangle', 0, 8, 0, 10] as const;
        expect(generateShapePoints(...args)).toEqual(generateShapePointsFromTransformers(...args));
        const saw = ['sawtooth-up', 0, 1, 0, 1] as const;
        expect(generateShapePoints(...saw)).toEqual(generateShapePointsFromTransformers(...saw));
    });
});
