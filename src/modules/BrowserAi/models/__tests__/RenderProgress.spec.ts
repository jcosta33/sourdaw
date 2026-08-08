import { describe, expect, it } from 'vitest';

import { RENDER_QUALITY_STEPS } from '../RenderProgress';

describe('RENDER_QUALITY_STEPS', () => {
    it('maps all 4 render quality levels', () => {
        expect(Object.keys(RENDER_QUALITY_STEPS)).toHaveLength(4);
        expect(RENDER_QUALITY_STEPS.low).toBeDefined();
        expect(RENDER_QUALITY_STEPS.standard).toBeDefined();
        expect(RENDER_QUALITY_STEPS.high).toBeDefined();
        expect(RENDER_QUALITY_STEPS.maximum).toBeDefined();
    });

    it('steps increase monotonically with quality', () => {
        expect(RENDER_QUALITY_STEPS.low).toBeLessThan(RENDER_QUALITY_STEPS.standard);
        expect(RENDER_QUALITY_STEPS.standard).toBeLessThan(RENDER_QUALITY_STEPS.high);
        expect(RENDER_QUALITY_STEPS.high).toBeLessThan(RENDER_QUALITY_STEPS.maximum);
    });

    it('has the expected step counts', () => {
        expect(RENDER_QUALITY_STEPS.low).toBe(3);
        expect(RENDER_QUALITY_STEPS.standard).toBe(5);
        expect(RENDER_QUALITY_STEPS.high).toBe(10);
        expect(RENDER_QUALITY_STEPS.maximum).toBe(20);
    });
});
