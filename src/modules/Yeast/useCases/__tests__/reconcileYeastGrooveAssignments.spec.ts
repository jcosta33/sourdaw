import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assignments: [] as Array<{
        consumerType: string;
        consumerId: string;
        templateId: string;
        amount: number;
    }>,
    restoreGrooveAssignment: vi.fn(),
    yeastState: {
        processors: [{ id: 'groove-live', type: 'groove', name: 'Groove', bypassed: false }],
        uiLevel: 1,
    },
}));

vi.mock('#/modules/MIDI/stores', () => ({
    grooveTemplateStore: {
        get value() {
            return { assignments: mocks.assignments };
        },
    },
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getScopedGrooveConsumerId: ({ ownerId, localId }: { ownerId: string; localId: string }) =>
        `${ownerId}:${localId}`,
    restoreGrooveAssignment: mocks.restoreGrooveAssignment,
}));
vi.mock('../../stores/yeastStore', () => ({ yeastStore: { value: mocks.yeastState } }));

const { reconcileYeastGrooveAssignments } = await import('../reconcileYeastGrooveAssignments');

describe('reconcileYeastGrooveAssignments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.assignments = [
            {
                consumerType: 'yeast-processor',
                consumerId: 'yeast-rack:groove-live',
                templateId: 'straight',
                amount: 0.5,
            },
            {
                consumerType: 'yeast-processor',
                consumerId: 'yeast-rack:groove-orphan',
                templateId: 'straight',
                amount: 0.5,
            },
            { consumerType: 'clip', consumerId: 'clip-1', templateId: 'straight', amount: 0.5 },
        ];
    });

    it('removes orphan assignments while preserving live Yeast and foreign consumers', () => {
        reconcileYeastGrooveAssignments();

        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledOnce();
        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledWith({
            consumerType: 'yeast-processor',
            consumerId: 'yeast-rack:groove-orphan',
            assignment: null,
        });
    });
});
