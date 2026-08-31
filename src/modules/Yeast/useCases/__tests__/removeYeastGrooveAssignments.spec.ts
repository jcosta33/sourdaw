import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assignments: [] as Array<{
        consumerType: string;
        consumerId: string;
        templateId: string;
        amount: number;
    }>,
    restoreGrooveAssignment: vi.fn(),
}));

vi.mock('#/modules/MIDI/stores', () => ({
    grooveTemplateStore: {
        get value() {
            return { assignments: mocks.assignments };
        },
    },
}));
vi.mock('#/modules/MIDI/useCases', () => ({
    getScopedGrooveConsumerId: ({ ownerId, localId }: { ownerId: string; localId: string }) => `${ownerId}:${localId}`,
    restoreGrooveAssignment: mocks.restoreGrooveAssignment,
    getScopedGrooveAssignment: vi.fn(),
}));

const { removeYeastGrooveAssignments } = await import('../removeYeastGrooveAssignments');

describe('removeYeastGrooveAssignments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.assignments = [
            { consumerType: 'yeast-processor', consumerId: 'groove-1', templateId: 'straight', amount: 0.5 },
            {
                consumerType: 'yeast-processor',
                consumerId: 'yeast-rack:groove-1',
                templateId: 'straight',
                amount: 0.5,
            },
            { consumerType: 'yeast-processor', consumerId: 'groove-2', templateId: 'straight', amount: 0.5 },
            { consumerType: 'clip', consumerId: 'groove-1', templateId: 'straight', amount: 0.5 },
        ];
    });

    it('removes only the legacy and scoped assignments owned by the processor', () => {
        removeYeastGrooveAssignments('groove-1');

        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledTimes(2);
        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledWith({
            consumerType: 'yeast-processor',
            consumerId: 'groove-1',
            assignment: null,
        });
        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledWith({
            consumerType: 'yeast-processor',
            consumerId: 'yeast-rack:groove-1',
            assignment: null,
        });
    });
});
