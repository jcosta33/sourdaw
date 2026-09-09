import { describe, it, expect, vi, beforeEach } from 'vitest';

import { setActiveYeastDevice, type YeastProcessorInfo, type YeastState } from '../../stores/yeastStore';
import { handleAddYeastProcessor } from '../addYeastProcessor';
import { handleRemoveYeastProcessor } from '../removeYeastProcessor';
import { handleReorderYeastProcessor } from '../reorderYeastProcessor';

const mocks = vi.hoisted(() => ({
    storeValue: { value: null as YeastState | null },
    addUseCase: vi.fn(),
    removeUseCase: vi.fn(),
    reorderUseCase: vi.fn(),
    commitProjection: vi.fn(),
}));
vi.mock('../../stores/yeastStore', () => ({
    yeastStore: {
        get value() {
            return mocks.storeValue.value;
        },
        set: vi.fn((state: YeastState) => {
            mocks.storeValue.value = state;
        }),
    },
    setActiveYeastDevice: vi.fn(),
}));
vi.mock('../../useCases/addYeastProcessor', () => ({
    addYeastProcessor: mocks.addUseCase,
}));
vi.mock('../../useCases/removeYeastProcessor', () => ({
    removeYeastProcessor: mocks.removeUseCase,
}));
vi.mock('../../useCases/reorderYeastProcessor', () => ({
    reorderYeastProcessor: mocks.reorderUseCase,
}));
vi.mock('../../useCases/commitYeastProjection', () => ({
    commitYeastProjection: mocks.commitProjection,
}));

function seedRack(processors: YeastProcessorInfo[]): void {
    mocks.storeValue.value = { processors, uiLevel: 3 };
}

function rack(): YeastProcessorInfo[] {
    return [
        { id: 'arp-1', type: 'arpeggiator', name: 'Arp', bypassed: false, params: {} },
        { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: true, params: { gate: 1.1 } },
    ];
}

describe('handleAddYeastProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setActiveYeastDevice(null);
    });

    it('adds through the use case with the payload id', () => {
        seedRack(rack());

        const result = handleAddYeastProcessor.execute({
            type: 'addYeastProcessor',
            payload: { processorId: 'chord-9', type: 'chord', name: 'Chord' },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.addUseCase).toHaveBeenCalledWith('chord', 'chord-9');
    });

    it('conflicts when the materialized id is already taken', () => {
        seedRack(rack());

        const result = handleAddYeastProcessor.execute({
            type: 'addYeastProcessor',
            payload: { processorId: 'arp-1', type: 'chord', name: 'Chord' },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.addUseCase).not.toHaveBeenCalled();
    });

    it('describes a remove inverse naming the processor it will create', () => {
        seedRack(rack());

        const described = handleAddYeastProcessor.describe({
            type: 'addYeastProcessor',
            payload: { processorId: 'chord-9', type: 'chord', name: 'Chord' },
        });

        expect(described.inverseAction).toEqual({
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'chord-9',
                expectedProcessor: { id: 'chord-9', type: 'chord', name: 'Chord', bypassed: false, params: {} },
                expectedIndex: 2,
            },
        });
    });

    it('re-inserts a removed processor at its old index on the restore leg', () => {
        seedRack([{ ...rack()[0]! }]);
        const restored = rack()[1]!;

        const result = handleAddYeastProcessor.execute({
            type: 'addYeastProcessor',
            payload: {
                processorId: restored.id,
                type: restored.type,
                name: restored.name,
                restore: { processor: restored, atIndex: 1 },
            },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.commitProjection).toHaveBeenCalledWith([rack()[0]!, restored]);
        expect(mocks.addUseCase).not.toHaveBeenCalled();
    });

    it('refuses the restore leg when the processor is no longer absent', () => {
        seedRack(rack());

        const result = handleAddYeastProcessor.execute({
            type: 'addYeastProcessor',
            payload: {
                processorId: 'filter-1',
                type: 'filter',
                name: 'Filter',
                restore: { processor: rack()[1]!, atIndex: 1 },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.commitProjection).not.toHaveBeenCalled();
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleAddYeastProcessor.undoable).toBe(true);
        expect(handleAddYeastProcessor.canReportConflict).toBe(true);
    });
});

describe('handleRemoveYeastProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes through the use case when the snapshot still matches', () => {
        seedRack(rack());

        const result = handleRemoveYeastProcessor.execute({
            type: 'removeYeastProcessor',
            payload: { processorId: 'filter-1', expectedProcessor: rack()[1]!, expectedIndex: 1 },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.removeUseCase).toHaveBeenCalledWith('filter-1');
    });

    it('refuses when the processor was edited since the snapshot', () => {
        seedRack(rack());

        const result = handleRemoveYeastProcessor.execute({
            type: 'removeYeastProcessor',
            payload: {
                processorId: 'filter-1',
                expectedProcessor: { id: 'filter-1', type: 'filter', name: 'Filter', bypassed: false, params: {} },
                expectedIndex: 1,
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.removeUseCase).not.toHaveBeenCalled();
    });

    it('describes an addYeastProcessor restore inverse captured pre-write', () => {
        seedRack(rack());

        const described = handleRemoveYeastProcessor.describe({
            type: 'removeYeastProcessor',
            payload: { processorId: 'filter-1', expectedProcessor: rack()[1]!, expectedIndex: 1 },
        });

        expect(described.inverseAction).toEqual({
            type: 'addYeastProcessor',
            payload: {
                processorId: 'filter-1',
                type: 'filter',
                name: 'Filter',
                restore: { processor: rack()[1]!, atIndex: 1 },
            },
        });
        expect(described.redoAction).toEqual({
            type: 'removeYeastProcessor',
            payload: { processorId: 'filter-1', expectedProcessor: rack()[1]!, expectedIndex: 1 },
        });
    });

    it('is a noop when the processor is already gone', () => {
        seedRack([]);

        expect(
            handleRemoveYeastProcessor.isNoop?.({
                type: 'removeYeastProcessor',
                payload: { processorId: 'filter-1', expectedProcessor: rack()[1]!, expectedIndex: 1 },
            })
        ).toBe(true);
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleRemoveYeastProcessor.undoable).toBe(true);
        expect(handleRemoveYeastProcessor.canReportConflict).toBe(true);
    });
});

describe('handleReorderYeastProcessor', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('moves through the use case when the id sequence matches', () => {
        seedRack(rack());

        const result = handleReorderYeastProcessor.execute({
            type: 'reorderYeastProcessor',
            payload: { processorId: 'arp-1', toIndex: 1, expectedOrder: ['arp-1', 'filter-1'] },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.reorderUseCase).toHaveBeenCalledWith(0, 1);
    });

    it('refuses when the rack sequence diverged', () => {
        seedRack(rack());

        const result = handleReorderYeastProcessor.execute({
            type: 'reorderYeastProcessor',
            payload: { processorId: 'arp-1', toIndex: 1, expectedOrder: ['filter-1', 'arp-1'] },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.reorderUseCase).not.toHaveBeenCalled();
    });

    it('describes a self-inverse guarded on the post-move sequence', () => {
        seedRack(rack());

        const described = handleReorderYeastProcessor.describe({
            type: 'reorderYeastProcessor',
            payload: { processorId: 'arp-1', toIndex: 1, expectedOrder: ['arp-1', 'filter-1'] },
        });

        expect(described.inverseAction).toEqual({
            type: 'reorderYeastProcessor',
            payload: { processorId: 'arp-1', toIndex: 0, expectedOrder: ['filter-1', 'arp-1'] },
        });
        expect(described.redoAction).toEqual({
            type: 'reorderYeastProcessor',
            payload: { processorId: 'arp-1', toIndex: 1, expectedOrder: ['arp-1', 'filter-1'] },
        });
    });

    it('validates against prior reorder siblings in the batch', () => {
        seedRack(rack());
        const context = {
            actions: [
                {
                    type: 'reorderYeastProcessor' as const,
                    payload: { processorId: 'arp-1', toIndex: 1, expectedOrder: ['arp-1', 'filter-1'] },
                },
            ],
            actionIndex: 1,
        };

        // After the sibling move the sequence is ['filter-1', 'arp-1'] — the
        // projected sequence, not the live one, is what the guard reads.
        expect(
            handleReorderYeastProcessor.validate!(
                {
                    type: 'reorderYeastProcessor',
                    payload: { processorId: 'filter-1', toIndex: 1, expectedOrder: ['filter-1', 'arp-1'] },
                },
                context
            )
        ).toBe(true);
        expect(
            handleReorderYeastProcessor.validate!(
                {
                    type: 'reorderYeastProcessor',
                    payload: { processorId: 'filter-1', toIndex: 1, expectedOrder: ['arp-1', 'filter-1'] },
                },
                context
            )
        ).toBe(false);
    });

    it('is undoable and declares conflict capability', () => {
        expect(handleReorderYeastProcessor.undoable).toBe(true);
        expect(handleReorderYeastProcessor.canReportConflict).toBe(true);
    });
});
