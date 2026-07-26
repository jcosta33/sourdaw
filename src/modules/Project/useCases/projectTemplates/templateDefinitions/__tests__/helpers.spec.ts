import { describe, it, expect } from 'vitest';

import { templates } from '../helpers';

describe('helpers', () => {
    it('exposes the empty project template', () => {
        const empty = templates.find((template) => template.id === 'empty');
        expect(empty).toBeDefined();
        expect(empty?.category).toBe('empty');
    });

    it('exposes all nine genre templates with non-empty descriptions', () => {
        const expectedIds = [
            'pop-song',
            'hiphop-trap',
            'edm',
            'rock-band',
            'lofi',
            'cinematic',
            'podcast',
            'singer-songwriter',
            'ambient',
        ] as const;
        for (const id of expectedIds) {
            const entry = templates.find((template) => template.id === id);
            expect(entry, `missing template ${id}`).toBeDefined();
            expect(entry?.description.length).toBeGreaterThan(20);
            expect(typeof entry?.create).toBe('function');
        }
    });

    it('registers Mycelium Ascendant without replacing Nebula Drift', () => {
        const demos = templates.filter((template) => template.category === 'demo');

        expect(demos.map((template) => template.id)).toEqual(['demo-nebula-drift', 'demo-mycelium-ascendant']);
        expect(demos.at(-1)).toMatchObject({
            name: 'Mycelium Ascendant',
            description:
                'Four minutes of psychedelic trance: rolling bass, organic signals, fractal effects, and deep automation.',
            executionBoundary: 'app-action',
        });
    });
});
