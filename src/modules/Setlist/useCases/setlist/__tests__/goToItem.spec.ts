import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { setlistStore } from '../../../stores/setlistStore';
import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { goToItem } from '../goToItem';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

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

describe('goToItem', () => {
    beforeEach(() => {
        vi.mocked(setlistStore.set).mockClear();
        setlistStoreMock.value = baseState([], 0);
    });

    it('should not change state or emit when index is out of range', () => {
        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(goToItem, { eventBus, setlistStore });

        goToItem(-1);

        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(setlistStore.set).not.toHaveBeenCalled();
    });

    it('should not wrap to the first item when index is past the last item', () => {
        const items = [baseItem({ id: 'a' }), baseItem({ id: 'b' })];
        setlistStoreMock.value = baseState(items, 1);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(goToItem, { eventBus, setlistStore });

        goToItem(items.length);

        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(setlistStore.set).not.toHaveBeenCalled();
        expect(setlistStore.value?.currentIndex).toBe(1);
    });

    it('should not wrap to the last item when index goes below zero', () => {
        const items = [baseItem({ id: 'a' }), baseItem({ id: 'b' })];
        setlistStoreMock.value = baseState(items, 0);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(goToItem, { eventBus, setlistStore });

        goToItem(-1);

        expect(setlistStore.set).not.toHaveBeenCalled();
        expect(setlistStore.value?.currentIndex).toBe(0);
    });

    it('should update setlist index and emit midi.out program change when configured', () => {
        const items = [
            baseItem({
                programChange: { channel: 2, program: 10 },
            }),
        ];
        setlistStoreMock.value = baseState(items, 0);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(goToItem, { eventBus, setlistStore });

        goToItem(0);

        expect(setlistStore.set).toHaveBeenCalled();
        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(eventBus.emit).toHaveBeenCalledWith('midi.out', {
            type: 'programChange',
            channel: 2,
            program: 10,
        });
    });

    it('should not emit program change when item has no programChange', () => {
        const items = [baseItem({ programChange: null })];
        setlistStoreMock.value = baseState(items, 0);

        const eventBus = createMock<EventBusShape>();
        eventBus.emit.mockResolvedValue(undefined);
        injectDependencies(goToItem, { eventBus, setlistStore });

        goToItem(0);

        expect(eventBus.emit).not.toHaveBeenCalled();
    });
});
