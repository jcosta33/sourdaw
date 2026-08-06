import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createBuiltinGrooveTemplates } from '#/modules/MIDI/models/BuiltinGrooveTemplates';

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

const validTemplate = {
    id: 'groove-custom-1',
    name: 'My Groove',
    schemaVersion: 1 as const,
    subdivision: '1/16' as const,
    slots: [{ index: 1, timingOffset: 0.12, dynamicsOffset: -0.3 }],
    provenance: { type: 'user' as const, sourceId: 'clip-1' },
};

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
