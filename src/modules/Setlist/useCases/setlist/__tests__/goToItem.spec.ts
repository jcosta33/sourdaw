import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import type { getTempoWriteTarget } from '#/modules/Transport/useCases';
import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { goToItem } from '../goToItem';

type TempoWriteTarget = NonNullable<ReturnType<typeof getTempoWriteTarget>>;

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
    executeAppActionBatch: vi.fn(async () => ({ status: 'committed' as const, actions: [] })),
    getTempoWriteTarget: vi.fn((): TempoWriteTarget | null => ({ tempo: 80, tempoChangeId: null, writable: true })),
}));

const setlistStoreMock = vi.hoisted(() => {
    const store: {
        value: import('../../../stores/setlistStore').SetlistState | null;
        set: ReturnType<typeof vi.fn>;
    } = {
        value: null,
        set: vi.fn((next: import('../../../stores/setlistStore').SetlistState) => {
            store.value = next;
        }),
    };
    return store;
});

vi.mock('../../../stores/setlistStore', () => ({
    setlistStore: setlistStoreMock,
}));

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return { ...actual, executeAppActionBatch: mocks.executeAppActionBatch };
});

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return { ...actual, getTempoWriteTarget: mocks.getTempoWriteTarget };
});

function baseItem(overrides?: Partial<SetlistItem>): SetlistItem {
    return {
        id: 'item-1',
        name: 'Song',
        projectPath: null,
        bpm: null,
        timeSignature: null,
        estimatedDuration: 120,
        notes: '',
        programChange: null,
        color: '#000',
        autoStop: false,
        gapSeconds: 0,
        markers: [],
        ...overrides,
    };
}

function baseState(items: SetlistItem[], currentIndex: number): SetlistState {
    return {
        name: 'Set',
        items,
        currentIndex,
        autoAdvance: false,
        countInBars: 1,
    };
}

function injectGoToItem(): EventBusShape {
    const eventBus: EventBusShape = { emit: vi.fn().mockResolvedValue(undefined) };
    injectDependencies(goToItem, { eventBus, setlistStore: setlistStoreMock });
    return eventBus;
}

describe('goToItem', () => {
    beforeEach(() => {
        vi.mocked(setlistStoreMock.set).mockClear();
        mocks.executeAppActionBatch.mockClear();
        mocks.executeAppActionBatch.mockResolvedValue({ status: 'committed', actions: [] });
        mocks.getTempoWriteTarget.mockReturnValue({ tempo: 80, tempoChangeId: null, writable: true });
        setlistStoreMock.value = baseState([], 0);
    });

    it('does not change state or emit when the index is out of range', async () => {
        const eventBus = injectGoToItem();

        await goToItem(-1);

        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(setlistStoreMock.set).not.toHaveBeenCalled();
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('does not wrap to the first item when the index is past the last item', async () => {
        const items = [baseItem({ id: 'a' }), baseItem({ id: 'b' })];
        setlistStoreMock.value = baseState(items, 1);

        injectGoToItem();

        await goToItem(items.length);

        expect(setlistStoreMock.set).not.toHaveBeenCalled();
        expect(setlistStoreMock.value?.currentIndex).toBe(1);
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('does not wrap to the last item when the index goes below zero', async () => {
        const items = [baseItem({ id: 'a' }), baseItem({ id: 'b' })];
        setlistStoreMock.value = baseState(items, 0);

        injectGoToItem();

        await goToItem(-1);

        expect(setlistStoreMock.set).not.toHaveBeenCalled();
        expect(setlistStoreMock.value?.currentIndex).toBe(0);
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('updates the runtime index and emits program change when configured', async () => {
        const items = [baseItem({ programChange: { channel: 2, program: 10 } })];
        setlistStoreMock.value = baseState(items, -1);

        const eventBus = injectGoToItem();

        await goToItem(0);

        expect(setlistStoreMock.set).toHaveBeenCalled();
        expect(setlistStoreMock.value?.currentIndex).toBe(0);
        expect(eventBus.emit).toHaveBeenCalledWith('midi.out', {
            type: 'programChange',
            channel: 2,
            program: 10,
        });
        expect(mocks.executeAppActionBatch).not.toHaveBeenCalled();
    });

    it('does not emit program change when the item has no program change', async () => {
        setlistStoreMock.value = baseState([baseItem()], -1);

        const eventBus = injectGoToItem();

        await goToItem(0);

        expect(eventBus.emit).not.toHaveBeenCalled();
    });

    it('dispatches configured BPM and meter together as project actions', async () => {
        setlistStoreMock.value = baseState(
            [baseItem({ bpm: 140, timeSignature: { numerator: 3, denominator: 4 } })],
            -1
        );

        injectGoToItem();

        await goToItem(0);

        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith(
            [
                { type: 'setTempo', payload: { bpm: 140 } },
                { type: 'setTimeSignature', payload: { numerator: 3, denominator: 4 } },
            ],
            expect.objectContaining({
                groupId: expect.any(String),
                groupLabel: 'Setlist: Song',
                shouldExecute: expect.any(Function),
            })
        );
    });

    it('keeps the current item and applies meter when a tempo-map ramp blocks BPM', async () => {
        setlistStoreMock.value = baseState(
            [baseItem({ bpm: 140, timeSignature: { numerator: 3, denominator: 4 } })],
            -1
        );
        mocks.getTempoWriteTarget.mockReturnValue({ tempo: 120, tempoChangeId: 'ramp', writable: false });

        injectGoToItem();

        await goToItem(0);

        expect(setlistStoreMock.value?.currentIndex).toBe(0);
        expect(mocks.executeAppActionBatch).toHaveBeenCalledWith(
            [{ type: 'setTimeSignature', payload: { numerator: 3, denominator: 4 } }],
            expect.any(Object)
        );
    });

    it('surfaces a rejected project action to the caller', async () => {
        setlistStoreMock.value = baseState([baseItem({ bpm: 140 })], -1);
        const failure = new Error('tempo command failed');
        mocks.executeAppActionBatch.mockRejectedValue(failure);

        injectGoToItem();

        await expect(goToItem(0)).rejects.toBe(failure);
        expect(setlistStoreMock.value?.currentIndex).toBe(0);
    });
});
