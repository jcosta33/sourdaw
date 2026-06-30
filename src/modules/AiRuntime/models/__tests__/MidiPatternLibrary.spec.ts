import { describe, expect, it } from 'vitest';

import { PATTERN_TEMPLATES, filterTemplates, type PatternCategory } from '../MidiPatternLibrary';

describe('MidiPatternLibrary', () => {
    it('should aggregate pattern templates in the category order expected by the browser', () => {
        const categoryTransitions = PATTERN_TEMPLATES.reduce<PatternCategory[]>((transitions, template) => {
            const previousCategory = transitions[transitions.length - 1];

            if (previousCategory !== template.category) {
                transitions.push(template.category);
            }

            return transitions;
        }, []);

        expect(categoryTransitions).toEqual(['chords', 'bass', 'drums', 'melody']);
        expect(PATTERN_TEMPLATES[0]?.id).toBe('ch-1564');
        expect(PATTERN_TEMPLATES[PATTERN_TEMPLATES.length - 1]?.id).toBe('ml-afrobeat');
    });

    it('should filter the aggregated pattern catalog by category', () => {
        const bassTemplates = filterTemplates({ category: 'bass' });
        const bassCategories = new Set(bassTemplates.map((template) => template.category));
        const bassTemplateIds = bassTemplates.map((template) => template.id);

        expect(bassCategories).toEqual(new Set(['bass']));
        expect(bassTemplateIds).toContain('bs-walking');
        expect(bassTemplateIds).toContain('bs-dnb');
    });
});
