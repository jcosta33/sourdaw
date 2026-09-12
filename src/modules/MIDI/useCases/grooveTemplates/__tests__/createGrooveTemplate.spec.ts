import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type GrooveTemplate, type GrooveTemplateProvenance } from '../../../models/GrooveTemplate';
import { defaultGrooveTemplateState, grooveTemplateStore } from '../../../stores/grooveTemplateStore';
import { createGrooveTemplate } from '../createGrooveTemplate';
import { prepareGrooveTemplateCreation } from '../prepareGrooveTemplateCreation';

const { mockMarkWrite } = vi.hoisted(() => ({
    mockMarkWrite: vi.fn(),
}));

vi.mock('../markGrooveTemplateProjectWrite', () => ({ markGrooveTemplateProjectWrite: mockMarkWrite }));

const input = {
    id: 'custom-groove',
    name: 'Custom Groove',
    subdivision: '1/16' as const,
    slots: [{ index: 1, timingOffset: 0.12, dynamicsOffset: -0.3 }],
    provenance: { type: 'user' as const, sourceId: 'clip-1' },
};

function reorderTemplate(template: GrooveTemplate): GrooveTemplate {
    let provenance: GrooveTemplateProvenance;
    if (template.provenance.type === 'midi-clip') {
        provenance = {
            analyzerVersion: template.provenance.analyzerVersion,
            sourceId: template.provenance.sourceId,
            type: template.provenance.type,
        };
    } else {
        provenance = { sourceId: template.provenance.sourceId, type: template.provenance.type };
    }
    return {
        provenance,
        slots: template.slots.map((slot) => ({
            dynamicsOffset: slot.dynamicsOffset,
            timingOffset: slot.timingOffset,
            index: slot.index,
        })),
        subdivision: template.subdivision,
        schemaVersion: template.schemaVersion,
        name: template.name,
        id: template.id,
    };
}

describe('createGrooveTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        grooveTemplateStore.set(structuredClone(defaultGrooveTemplateState));
    });

    it('returns no-write for an existing template whose object keys were reordered', () => {
        const canonical = prepareGrooveTemplateCreation(input);
        const reordered = reorderTemplate(canonical);
        const state = grooveTemplateStore.value;
        if (!state) {
            throw new Error('Expected groove template state');
        }
        grooveTemplateStore.set({ ...state, templates: [...state.templates, reordered] });
        const beforeCreate = grooveTemplateStore.value;

        expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(canonical));
        expect(createGrooveTemplate(input)).toEqual({ status: 'no-write', template: reordered });
        expect(grooveTemplateStore.value).toBe(beforeCreate);
        expect(mockMarkWrite).not.toHaveBeenCalled();
    });

    it.each([
        ['name', { ...input, name: 'Changed Groove' }],
        ['timing', { ...input, slots: [{ ...input.slots[0]!, timingOffset: 0.2 }] }],
        ['dynamics', { ...input, slots: [{ ...input.slots[0]!, dynamicsOffset: 0.4 }] }],
    ])('rejects changed %s content under an existing identity', (_field, changedInput) => {
        const existing = prepareGrooveTemplateCreation(input);
        const state = grooveTemplateStore.value;
        if (!state) {
            throw new Error('Expected groove template state');
        }
        grooveTemplateStore.set({ ...state, templates: [...state.templates, existing] });
        const beforeCreate = grooveTemplateStore.value;

        expect(() => createGrooveTemplate(changedInput)).toThrow('Groove template identity conflict');
        expect(grooveTemplateStore.value).toBe(beforeCreate);
        expect(mockMarkWrite).not.toHaveBeenCalled();
    });

    it('preserves slot array order as part of template identity', () => {
        const twoSlotInput = {
            ...input,
            slots: [
                { index: 1, timingOffset: 0.12, dynamicsOffset: -0.3 },
                { index: 2, timingOffset: -0.08, dynamicsOffset: 0.2 },
            ],
        };
        const canonical = prepareGrooveTemplateCreation(twoSlotInput);
        const reorderedSlots = { ...canonical, slots: [...canonical.slots].reverse() };
        const state = grooveTemplateStore.value;
        if (!state) {
            throw new Error('Expected groove template state');
        }
        grooveTemplateStore.set({ ...state, templates: [...state.templates, reorderedSlots] });
        const beforeCreate = grooveTemplateStore.value;

        expect(() => createGrooveTemplate(twoSlotInput)).toThrow('Groove template identity conflict');
        expect(grooveTemplateStore.value).toBe(beforeCreate);
        expect(mockMarkWrite).not.toHaveBeenCalled();
    });
});
