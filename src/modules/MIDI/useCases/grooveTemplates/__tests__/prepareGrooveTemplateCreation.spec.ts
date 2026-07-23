import { describe, it, expect, beforeEach } from 'vitest';

import { type GrooveTemplateSlot } from '../../../models/GrooveTemplate';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { prepareGrooveTemplateCreation } from '../prepareGrooveTemplateCreation';

function validInput(overrides: Partial<Parameters<typeof prepareGrooveTemplateCreation>[0]> = {}) {
    const slots: GrooveTemplateSlot[] = [{ index: 0, timingOffset: 0.1, dynamicsOffset: -0.2 }];
    return {
        id: 'groove-new',
        name: 'New Groove',
        subdivision: '1/16' as const,
        slots,
        provenance: { type: 'user' as const, sourceId: 'user-1' },
        ...overrides,
    };
}

describe('prepareGrooveTemplateCreation', () => {
    beforeEach(() => {
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('builds a canonical template from valid input', () => {
        const template = prepareGrooveTemplateCreation(validInput());
        expect(template.id).toBe('groove-new');
        expect(template.name).toBe('New Groove');
        expect(template.subdivision).toBe('1/16');
        expect(template.schemaVersion).toBe(1);
        expect(template.slots).toHaveLength(1);
    });

    it('clamps slot timingOffset into [-0.5, 0.5]', () => {
        const template = prepareGrooveTemplateCreation(
            validInput({ slots: [{ index: 0, timingOffset: 0.9, dynamicsOffset: 0 }] })
        );
        expect(template.slots[0]!.timingOffset).toBe(0.5);
    });

    it('clamps slot dynamicsOffset into [-1, 1]', () => {
        const template = prepareGrooveTemplateCreation(
            validInput({ slots: [{ index: 0, timingOffset: 0, dynamicsOffset: -2 }] })
        );
        expect(template.slots[0]!.dynamicsOffset).toBe(-1);
    });

    it('drops slots with an out-of-range index', () => {
        // 1/16 → 16 slots (index 0-15). Index 16 is out of range.
        const template = prepareGrooveTemplateCreation(
            validInput({
                slots: [
                    { index: 0, timingOffset: 0.1, dynamicsOffset: 0 },
                    { index: 16, timingOffset: 0.1, dynamicsOffset: 0 },
                ],
            })
        );
        expect(template.slots).toHaveLength(1);
        expect(template.slots[0]!.index).toBe(0);
    });

    it('deduplicates slots by index, keeping the last', () => {
        const template = prepareGrooveTemplateCreation(
            validInput({
                slots: [
                    { index: 0, timingOffset: 0.1, dynamicsOffset: 0 },
                    { index: 0, timingOffset: 0.2, dynamicsOffset: 0.3 },
                ],
            })
        );
        expect(template.slots).toHaveLength(1);
        expect(template.slots[0]!.timingOffset).toBe(0.2);
    });

    it('sorts surviving slots by index ascending', () => {
        const template = prepareGrooveTemplateCreation(
            validInput({
                slots: [
                    { index: 3, timingOffset: 0.1, dynamicsOffset: 0 },
                    { index: 1, timingOffset: 0.1, dynamicsOffset: 0 },
                    { index: 2, timingOffset: 0.1, dynamicsOffset: 0 },
                ],
            })
        );
        expect(template.slots.map((slot) => slot.index)).toEqual([1, 2, 3]);
    });

    it('deep-clones the provenance (no shared reference)', () => {
        const provenance = { type: 'user' as const, sourceId: 'user-1' };
        const template = prepareGrooveTemplateCreation(validInput({ provenance }));
        expect(template.provenance).toEqual(provenance);
        expect(template.provenance).not.toBe(provenance);
    });

    it('resolves a name collision with an existing template', () => {
        // The default state contains a "Straight" builtin.
        const template = prepareGrooveTemplateCreation(validInput({ name: 'Straight' }));
        expect(template.name).toBe('Straight 2');
    });

    it('ignores its own id during name collision resolution when updating an existing user template', () => {
        // Seed a user template with id 'groove-existing' and name 'Funk'.
        grooveTemplateStore.set({
            ...structuredClone(defaultGrooveTemplateState),
            templates: [
                ...defaultGrooveTemplateState.templates,
                {
                    id: 'groove-existing',
                    name: 'Funk',
                    schemaVersion: 1,
                    subdivision: '1/16',
                    slots: [],
                    provenance: { type: 'user', sourceId: 'u1' },
                },
            ],
        });
        // Re-create with the same id and name → no collision because the own id is ignored.
        const template = prepareGrooveTemplateCreation(validInput({ id: 'groove-existing', name: 'Funk' }));
        expect(template.name).toBe('Funk');
    });

    it('throws when the id is empty/whitespace', () => {
        expect(() => prepareGrooveTemplateCreation(validInput({ id: '   ' }))).toThrow();
    });

    it('canonicalizes a whitespace-padded id', () => {
        const template = prepareGrooveTemplateCreation(validInput({ id: '  groove-padded  ' }));
        expect(template.id).toBe('groove-padded');
    });
});
