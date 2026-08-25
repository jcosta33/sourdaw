import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    assignments: [] as Array<{
        consumerType: string;
        consumerId: string;
        templateId: string;
        amount: number;
    }>,
    restoreGrooveAssignment: vi.fn(),
    racks: [
        {
            processors: [{ id: 'groove-live', type: 'groove', name: 'Groove', bypassed: false }],
            uiLevel: 1,
        },
    ],
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
}));
vi.mock('../../stores/yeastStore', () => ({
    // Rack state is per device instance (issue #2422): the live-consumer set
    // is the union across every rack, provided here as the store would.
    readAllYeastRacks: () => mocks.racks,
}));

const { reconcileYeastGrooveAssignments } = await import('../reconcileYeastGrooveAssignments');

describe('reconcileYeastGrooveAssignments', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.racks = [
            {
                processors: [{ id: 'groove-live', type: 'groove', name: 'Groove', bypassed: false }],
                uiLevel: 1,
            },
        ];
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

    it('keeps groove assignments of non-active device racks', () => {
        // Two devices, each with its own rack: reconciling after a commit on
        // the ACTIVE rack must not strip the other device's groove
        // assignment. Mutation: reverting the live-consumer set to the
        // active rack only reds this test.
        mocks.racks = [
            {
                processors: [{ id: 'groove-a', type: 'groove', name: 'A', bypassed: false }],
                uiLevel: 1,
            },
            {
                processors: [{ id: 'groove-b', type: 'groove', name: 'B', bypassed: false }],
                uiLevel: 1,
            },
        ];
        mocks.assignments = [
            {
                consumerType: 'yeast-processor',
                consumerId: 'yeast-rack:groove-a',
                templateId: 'straight',
                amount: 0.5,
            },
            {
                consumerType: 'yeast-processor',
                consumerId: 'yeast-rack:groove-b',
                templateId: 'straight',
                amount: 0.5,
            },
        ];

        reconcileYeastGrooveAssignments();

        expect(mocks.restoreGrooveAssignment).not.toHaveBeenCalled();
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
