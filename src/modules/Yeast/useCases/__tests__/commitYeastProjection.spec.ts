import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type YeastState } from '../../models/YeastState';

/** One live groove processor and one the tests drop from the committed list. */
function createProcessorPair(): YeastState {
    return {
        processors: [
            { id: 'groove-live', type: 'groove', name: 'Groove', bypassed: false, params: {} },
            { id: 'groove-dropped', type: 'groove', name: 'Dropped', bypassed: false, params: {} },
        ],
        uiLevel: 1,
    };
}

const mocks = vi.hoisted(() => ({
    assignments: [] as Array<{
        consumerType: string;
        consumerId: string;
        templateId: string;
        amount: number;
    }>,
    restoreGrooveAssignment: vi.fn(),
    setYeastRuntimeProjection: vi.fn(),
    yeastState: createProcessorPair(),
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
vi.mock('../../engine/yeastRuntime', () => ({ setYeastRuntimeProjection: mocks.setYeastRuntimeProjection }));
// The runtime projection resolves groove templates through its own MIDI
// dependencies; this spec is about the store commit and the reconciliation, so
// the runtime side is stubbed out rather than half-mocked.
vi.mock('../createYeastRuntimeProjection', () => ({ createYeastRuntimeProjection: () => [] }));
vi.mock('../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return mocks.yeastState;
        },
        set: vi.fn((next: YeastState) => {
            mocks.yeastState = next;
        }),
    },
    // Groove-assignment reconcile reads the union of every rack; the mocked
    // active rack is the only one these tests carry.
    readAllYeastRacks: () => [mocks.yeastState ?? { processors: [], uiLevel: 1 }],
}));

const { commitYeastProjection } = await import('../commitYeastProjection');

/**
 * Review round 1 on PR #793: the groove-assignment safety net used to live in
 * the CRDT projection, which the incremental local-origin skip stopped running.
 * It now lives here, on the single write path every processor-list mutation
 * goes through — `removeYeastProcessor` is no longer the only path that cleans
 * up after a dropped processor.
 */
describe('commitYeastProjection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.yeastState = createProcessorPair();
        mocks.assignments = [
            {
                consumerType: 'yeast-processor',
                consumerId: 'yeast-rack:groove-live',
                templateId: 'straight',
                amount: 0.5,
            },
            {
                consumerType: 'yeast-processor',
                consumerId: 'yeast-rack:groove-dropped',
                templateId: 'straight',
                amount: 0.5,
            },
        ];
    });

    it('drops the groove assignment of a processor the commit removed', () => {
        commitYeastProjection([mocks.yeastState.processors[0]!]);

        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledOnce();
        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledWith({
            consumerType: 'yeast-processor',
            consumerId: 'yeast-rack:groove-dropped',
            assignment: null,
        });
    });

    it('keeps assignments whose processor survived the commit', () => {
        commitYeastProjection(mocks.yeastState.processors);

        expect(mocks.restoreGrooveAssignment).not.toHaveBeenCalled();
        expect(mocks.yeastState.processors.map((processor) => processor.id)).toEqual(['groove-live', 'groove-dropped']);
    });

    it('reconciles against the committed list, not the pre-commit one', () => {
        // The reconciliation must observe the already-written store, or it
        // would consider the dropped processor still live and no-op.
        mocks.restoreGrooveAssignment.mockImplementation(() => {
            expect(mocks.yeastState.processors.map((processor) => processor.id)).toEqual(['groove-live']);
        });

        commitYeastProjection([mocks.yeastState.processors[0]!]);

        expect(mocks.restoreGrooveAssignment).toHaveBeenCalledOnce();
    });
});
