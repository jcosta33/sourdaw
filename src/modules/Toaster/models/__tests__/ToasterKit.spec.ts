import { describe, expect, it } from 'vitest';

import { createDefaultKit, withActivePatternId } from '../ToasterKit';

describe('withActivePatternId', () => {
    it('switches the active pattern when the id names an existing pattern', () => {
        const base = createDefaultKit();
        const kit = {
            ...base,
            patterns: [...base.patterns, { ...base.patterns[0]!, id: 'B1', name: 'Pattern B1' }],
        };

        const next = withActivePatternId(kit, 'B1');

        expect(next).not.toBe(kit);
        expect(next.activePatternId).toBe('B1');
    });

    it('returns the same kit reference when the id does not name an existing pattern', () => {
        const kit = createDefaultKit();

        const next = withActivePatternId(kit, 'does-not-exist');

        expect(next).toBe(kit);
        expect(next.activePatternId).toBe('A1');
    });

    it('returns the same kit reference when the id is already active', () => {
        const kit = createDefaultKit();

        expect(withActivePatternId(kit, 'A1')).toBe(kit);
    });
});
