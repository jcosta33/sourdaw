import { describe, it, expect } from 'vitest';

import { type GenerationParams, type PatternTemplate } from '../../../models/MidiPatternType';
import { toPublicPatternTemplate } from '../toPublicPatternTemplate';

describe('toPublicPatternTemplate', () => {
    it('should map a model pattern template to the public format', () => {
        const modelTemplate = {
            id: 't1',
            name: 'Test Template',
            category: 'drums',
            genres: ['pop'],
            tags: ['basic'],
            description: 'test description',
            lengthBeats: 4,
            generate: () => [{ pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }],
        } satisfies PatternTemplate;

        const mapped = toPublicPatternTemplate(modelTemplate);
        const params = {
            key: 'C',
            scale: 'major',
            density: 5,
            complexity: 5,
        } satisfies GenerationParams;

        expect(mapped.id).toBe('t1');
        expect(mapped.name).toBe('Test Template');
        expect(mapped.category).toBe('drums');
        expect(mapped.genres).toEqual(['pop']);
        expect(mapped.tags).toEqual(['basic']);
        expect(mapped.description).toBe('test description');
        expect(mapped.lengthBeats).toBe(4);
        expect(mapped.generate(params)).toEqual([{ pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }]);
    });
});
