import { describe, it, expect } from 'vitest';

import { applyVelocityCurve as applyFromTransformer } from '../../../transformers/velocityCurveTransformer';
import { applyVelocityCurve } from '../applyVelocityCurve';

describe('applyVelocityCurve (public automationQueries export)', () => {
    it('should match the velocity curve transformer for each curve type', () => {
        const curves = ['linear', 'exponential', 'logarithmic', 's-curve', 'compress', 'expand'] as const;
        for (const curve of curves) {
            for (const t of [0, 0.25, 0.5, 0.75, 1]) {
                expect(applyVelocityCurve(t, curve)).toBe(applyFromTransformer(t, curve));
            }
        }
    });
});
