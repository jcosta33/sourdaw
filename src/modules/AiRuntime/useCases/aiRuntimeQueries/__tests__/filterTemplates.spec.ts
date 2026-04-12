import { describe, it, expect, vi } from 'vitest';
import { filterTemplates } from '../filterTemplates';

vi.mock('#/modules/AiRuntime/models/midiPatternLibrary', () => ({
    PATTERN_TEMPLATES: [
        {
            id: 't1',
            name: 'Basic Beat',
            category: 'drum',
            genres: ['pop'],
            tags: ['basic'],
            description: 'basic drum beat',
            generate: vi.fn(() => []),
            lengthBeats: 4,
        },
        {
            id: 't2',
            name: 'Ambient Pad',
            category: 'chord',
            genres: ['ambient'],
            tags: ['pad'],
            description: 'pad',
            generate: vi.fn(() => []),
            lengthBeats: 16,
        },
    ],
    filterTemplates: vi.fn((filters) => {
        // Simple mock of the underlying filter logic for this test file
        const templates = [
            {
                id: 't1',
                name: 'Basic Beat',
                category: 'drum',
                genres: ['pop'],
                tags: ['basic'],
                description: 'basic drum beat',
                generate: vi.fn(() => []),
                lengthBeats: 4,
            },
            {
                id: 't2',
                name: 'Ambient Pad',
                category: 'chord',
                genres: ['ambient'],
                tags: ['pad'],
                description: 'pad',
                generate: vi.fn(() => []),
                lengthBeats: 16,
            },
        ];
        return templates.filter((t) => {
            if (filters.category && t.category !== filters.category) {return false;}
            if (filters.query && !t.name.includes(filters.query)) {return false;}
            return true;
        });
    }),
}));

describe('filterTemplates (aiRuntimeQueries)', () => {
    it('applies filters and maps to public interface', () => {
        // Using a basic filter to reduce results
        const filtered = filterTemplates({ category: 'drum' });
        
        expect(filtered.length).toBe(1);
        
        const first = filtered[0]!;
        expect(first).toHaveProperty('id');
        expect(first).toHaveProperty('name');
        expect(first.category).toBe('drum');
        expect(typeof first.generate).toBe('function');
    });

    it('returns empty array if no templates match', () => {
        const filtered = filterTemplates({ query: 'non-existent-impossible-string' });
        expect(filtered).toHaveLength(0);
    });
});
