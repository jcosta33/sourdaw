import { describe, expect, it } from 'vitest';

import { GROOVE_TEMPLATES } from '../GrooveTemplates';

describe('GROOVE_TEMPLATES', () => {
    it('should give every template a name and sixteen micro-timing offsets', () => {
        expect(GROOVE_TEMPLATES.length).toBeGreaterThan(0);
        for (const t of GROOVE_TEMPLATES) {
            expect(t.name.length).toBeGreaterThan(0);
            expect(t.offsets).toHaveLength(16);
        }
    });

    it('should keep offsets within the documented swing range', () => {
        for (const t of GROOVE_TEMPLATES) {
            for (const v of t.offsets) {
                expect(v).toBeGreaterThanOrEqual(-0.5);
                expect(v).toBeLessThanOrEqual(0.5);
            }
        }
    });

    it('should include a straight grid with zero offsets', () => {
        const straight = GROOVE_TEMPLATES.find((t) => t.name === 'Straight');
        expect(straight).toBeDefined();
        expect(straight!.offsets.every((o) => o === 0)).toBe(true);
    });
});
