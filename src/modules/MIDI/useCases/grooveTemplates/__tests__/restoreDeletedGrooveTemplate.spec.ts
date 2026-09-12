import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBuiltinGrooveTemplates } from '#/modules/MIDI/models/BuiltinGrooveTemplates';
import { type GrooveTemplate, type GrooveTemplateProvenance } from '#/modules/MIDI/models/GrooveTemplate';

const { mockStore, mockMarkWrite, mockResolveName } = vi.hoisted(() => ({
    mockStore: {
        value: null as unknown as {
            templates: ReturnType<typeof createBuiltinGrooveTemplates>;
            assignments: unknown[];
        },
        set: vi.fn((state: unknown) => {
            mockStore.value = state as {
                templates: ReturnType<typeof createBuiltinGrooveTemplates>;
                assignments: unknown[];
            };
        }),
    },
    mockMarkWrite: vi.fn(),
    mockResolveName: vi.fn((name: string) => name),
}));

vi.mock('../../../stores/grooveTemplateStore', () => ({
    grooveTemplateStore: mockStore,
    isGrooveTemplateAssignment: vi.fn((value: unknown) => {
        const v = value as Record<string, unknown>;
        return (
            typeof v.consumerType === 'string' &&
            typeof v.consumerId === 'string' &&
            typeof v.templateId === 'string' &&
            typeof v.amount === 'number'
        );
    }),
}));
vi.mock('../../../models/GrooveTemplateState', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../models/GrooveTemplateState')>();
    return {
        ...actual,
        isGrooveTemplateState: vi.fn(() => true),
    };
});
vi.mock('../markGrooveTemplateProjectWrite', () => ({ markGrooveTemplateProjectWrite: mockMarkWrite }));
vi.mock('../resolveGrooveTemplateName', () => ({ resolveGrooveTemplateName: mockResolveName }));

import { type DeletedGrooveTemplateSnapshot } from '../deleteGrooveTemplate';
import { restoreDeletedGrooveTemplate } from '../restoreDeletedGrooveTemplate';

const validTemplate: GrooveTemplate = {
    id: 'groove-custom-1',
    name: 'My Groove',
    schemaVersion: 1 as const,
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

function resetStore(): void {
    mockStore.value = {
        templates: [...createBuiltinGrooveTemplates()],
        assignments: [
            {
                consumerType: 'clip' as const,
                consumerId: 'clip-1',
                templateId: 'groove-straight',
                amount: 1,
            },
        ],
    };
}

describe('restoreDeletedGrooveTemplate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        resetStore();
    });
    it('throws when the store has no value', () => {
        (mockStore as { value: unknown }).value = null;
        expect(() =>
            restoreDeletedGrooveTemplate({ template: validTemplate, templateIndex: 0, assignments: [] })
        ).toThrow('state is unavailable');
    });

    it('throws when the snapshot template is not canonical', () => {
        expect(() =>
            restoreDeletedGrooveTemplate({
                template: { ...validTemplate, id: '' },
                templateIndex: 0,
                assignments: [],
            })
        ).toThrow('not canonical');
    });

    it('throws when a snapshot assignment references a different template id', () => {
        expect(() =>
            restoreDeletedGrooveTemplate({
                template: validTemplate,
                templateIndex: 1,
                assignments: [
                    {
                        index: 0,
                        assignment: {
                            consumerType: 'clip',
                            consumerId: 'clip-1',
                            templateId: 'different-id',
                            amount: 1,
                        },
                    },
                ],
            })
        ).toThrow('different template');
    });

    it('restores the template and marks a project write', () => {
        const originalCount = mockStore.value.templates.length;
        const snapshot: DeletedGrooveTemplateSnapshot = {
            template: validTemplate,
            templateIndex: 1,
            assignments: [],
        };
        restoreDeletedGrooveTemplate(snapshot);
        expect(mockStore.value.templates).toHaveLength(originalCount + 1);
        expect(mockStore.value.templates.some((t) => t.id === 'groove-custom-1')).toBe(true);
        expect(mockMarkWrite).toHaveBeenCalledTimes(1);
    });

    it('accepts an identical recreated template whose object keys were reordered', () => {
        const reordered = reorderTemplate(validTemplate);
        mockStore.value.templates.push(reordered);
        const originalCount = mockStore.value.templates.length;

        expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(validTemplate));
        restoreDeletedGrooveTemplate({ template: validTemplate, templateIndex: 1, assignments: [] });

        expect(mockStore.set).toHaveBeenCalledTimes(1);
        expect(mockStore.value.templates).toHaveLength(originalCount);
        expect(mockStore.value.templates.filter((template) => template.id === validTemplate.id)).toHaveLength(1);
        expect(mockMarkWrite).toHaveBeenCalledTimes(1);
    });

    it('rejects a recreated identity with changed musical content without writing', () => {
        mockStore.value.templates.push({
            ...validTemplate,
            slots: validTemplate.slots.map((slot) => ({ ...slot, timingOffset: slot.timingOffset + 0.01 })),
        });

        expect(() =>
            restoreDeletedGrooveTemplate({ template: validTemplate, templateIndex: 1, assignments: [] })
        ).toThrow('identity was recreated with different content');
        expect(mockStore.set).not.toHaveBeenCalled();
        expect(mockMarkWrite).not.toHaveBeenCalled();
    });

    it('restores assignments that were pointing to straight groove back to the deleted template', () => {
        const snapshot: DeletedGrooveTemplateSnapshot = {
            template: validTemplate,
            templateIndex: 1,
            assignments: [
                {
                    index: 0,
                    assignment: {
                        consumerType: 'clip',
                        consumerId: 'clip-1',
                        templateId: 'groove-custom-1',
                        amount: 1,
                    },
                },
            ],
        };
        restoreDeletedGrooveTemplate(snapshot);
        // The assignment for clip-1 should now point to groove-custom-1
        const assignments = mockStore.value.assignments as Array<{ consumerId: string; templateId: string }>;
        const assignment = assignments.find((a) => a.consumerId === 'clip-1');
        expect(assignment?.templateId).toBe('groove-custom-1');
    });
});
