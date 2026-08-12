import { describe, it, expect, beforeEach } from 'vitest';

import { grooveStore, defaultGrooveState, sanitizeGrooveTemplates, type GrooveTemplate } from '../grooveStore';

function makeTemplate(id: string): GrooveTemplate {
    return { id, name: `Template ${id}`, offsets: [0, 0.1, 0, 0.1], resolution: 0.25 };
}

// F6 — grooveStore used to be memory-only; the project's active groove
// selection and any custom templates vanished on reload. Now backed by
// `createAutomergeStorage`, so this covers the decode contract hydration
// relies on.
describe('grooveStore', () => {
    beforeEach(() => {
        grooveStore.set(defaultGrooveState);
    });

    it('boots with the built-in swing-16th template and no active project groove', () => {
        const state = grooveStore.value!;
        expect(state.templates).toHaveLength(1);
        expect(state.templates[0]?.id).toBe('swing-16th');
        expect(state.projectGrooveId).toBeNull();
    });

    it('stores a custom template and an active project groove selection', () => {
        grooveStore.set({
            templates: [...defaultGrooveState.templates, makeTemplate('custom')],
            projectGrooveId: 'custom',
            projectGrooveIntensity: 0.75,
        });

        const state = grooveStore.value!;
        expect(state.templates.map((template) => template.id)).toEqual(['swing-16th', 'custom']);
        expect(state.projectGrooveId).toBe('custom');
        expect(state.projectGrooveIntensity).toBe(0.75);
    });

    it('subscribers fire on set', () => {
        let called = false;
        const unsubscribe = grooveStore.subscribe(() => {
            called = true;
        });
        grooveStore.set({ ...defaultGrooveState, projectGrooveIntensity: 0.9 });
        expect(called).toBe(true);
        unsubscribe();
    });

    describe('sanitizeGrooveTemplates', () => {
        it('keeps a well-formed persisted template and copies its offsets', () => {
            const persisted = [makeTemplate('custom')];

            const decoded = sanitizeGrooveTemplates(persisted);

            expect(decoded).toEqual(persisted);
            expect(decoded[0]?.offsets).not.toBe(persisted[0]?.offsets);
        });

        it('drops rows that do not decode and keeps the ones that do', () => {
            const decoded = sanitizeGrooveTemplates([
                { id: '', name: 'No id', offsets: [], resolution: 0.25 },
                { id: 't-bad', name: 'Bad offsets', offsets: ['not-a-number'], resolution: 0.25 },
                makeTemplate('t-ok'),
                { ...makeTemplate('t-ok'), name: 'Duplicate' },
            ]);

            expect(decoded.map((template) => template.id)).toEqual(['t-ok']);
        });

        it('decodes a non-array to no templates', () => {
            expect(sanitizeGrooveTemplates(undefined)).toEqual([]);
        });
    });
});
