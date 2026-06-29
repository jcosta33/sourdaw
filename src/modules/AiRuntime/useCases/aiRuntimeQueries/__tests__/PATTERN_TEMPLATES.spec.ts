import { describe, it, expect } from 'vitest';

import { PATTERN_TEMPLATES as modelPatternTemplates } from '../../../models/MidiPatternLibrary';
import { PATTERN_TEMPLATES } from '../PATTERN_TEMPLATES';

describe('PATTERN_TEMPLATES', () => {
    it('exports mapped templates matching the length of the underlying model templates', () => {
        expect(PATTERN_TEMPLATES.length).toBe(modelPatternTemplates.length);
        expect(PATTERN_TEMPLATES.length).toBeGreaterThan(0);
    });

    it('maps templates using toPublicPatternTemplate (should have id, name, category)', () => {
        const firstTemplate = PATTERN_TEMPLATES[0]!;
        expect(firstTemplate).toHaveProperty('id');
        expect(firstTemplate).toHaveProperty('name');
        expect(firstTemplate).toHaveProperty('category');
    });
});
