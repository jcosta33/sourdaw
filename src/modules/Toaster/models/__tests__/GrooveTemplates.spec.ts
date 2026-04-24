import { describe, expect, it } from 'vitest';

import { GROOVE_TEMPLATES } from '../GrooveTemplates';

describe('GROOVE_TEMPLATES', () => {
    it('should give every template a name and sixteen micro-timing offsets', () => {
        expect(GROOVE_TEMPLATES.length).toBeGreaterThan(0);
        for (const time of GROOVE_TEMPLATES) {
            expect(time.name.length).toBeGreaterThan(0);
            expect(time.offsets).toHaveLength(16);
        }
    });

    it('should keep offsets within the documented swing range', () => {
        for (const time of GROOVE_TEMPLATES) {
            for (const value of time.offsets) {
                expect(value).toBeGreaterThanOrEqual(-0.5);
                expect(value).toBeLessThanOrEqual(0.5);
            }
        }
    });

    it('should include a straight grid with zero offsets', () => {
        const straight = GROOVE_TEMPLATES.find((time) => time.name === 'Straight');
        expect(straight).toBeDefined();
        expect(straight!.offsets.every((output) => output === 0)).toBe(true);
    });
});
