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

    it('preserves the pre-existing demo entries', () => {
        const demoIds = templates.filter((template) => template.category === 'demo').map((template) => template.id);
        expect(demoIds).toContain('demo-complete');
        expect(demoIds).toContain('demo-nebula-drift');
    });
});
