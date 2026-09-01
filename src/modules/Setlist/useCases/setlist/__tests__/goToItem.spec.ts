import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { createAppError } from '#/infra/errors/createAppError';

import { setlistStore } from '../../../stores/setlistStore';
import { type SetlistItem, type SetlistState } from '../../../stores/setlistStore';
import { goToItem } from '../goToItem';

type EventBusShape = {
    emit: ReturnType<typeof vi.fn>;
};

const mocks = vi.hoisted(() => ({
    setTempo: vi.fn(() => ({ status: 'written' as const })),
    setTimeSignature: vi.fn(),
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

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return { ...actual, setTempo: mocks.setTempo, setTimeSignature: mocks.setTimeSignature };
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
    const eventBus = createMock<EventBusShape>();
    eventBus.emit.mockResolvedValue(undefined);
    injectDependencies(goToItem, { eventBus, setlistStore });
    return eventBus;
}

describe('goToItem', () => {
    beforeEach(() => {
        vi.mocked(setlistStore.set).mockClear();
        mocks.setTempo.mockClear();
        mocks.setTimeSignature.mockClear();
        mocks.setTempo.mockImplementation(() => ({ status: 'written' as const }));
        setlistStoreMock.value = baseState([], 0);
    });

    it('should not change state or emit when index is out of range', () => {
        const eventBus = injectGoToItem();

        goToItem(-1);

        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(setlistStore.set).not.toHaveBeenCalled();
        expect(mocks.setTempo).not.toHaveBeenCalled();
        expect(mocks.setTimeSignature).not.toHaveBeenCalled();
    });

    it('should not wrap to the first item when index is past the last item', () => {
        const items = [baseItem({ id: 'a' }), baseItem({ id: 'b' })];
        setlistStoreMock.value = baseState(items, 1);

        injectGoToItem();

        goToItem(items.length);

        expect(setlistStore.set).not.toHaveBeenCalled();
        expect(setlistStore.value?.currentIndex).toBe(1);
        expect(mocks.setTempo).not.toHaveBeenCalled();
        expect(mocks.setTimeSignature).not.toHaveBeenCalled();
    });

    it('should not wrap to the last item when index goes below zero', () => {
        const items = [baseItem({ id: 'a' }), baseItem({ id: 'b' })];
        setlistStoreMock.value = baseState(items, 0);

        injectGoToItem();

        goToItem(-1);

        expect(setlistStore.set).not.toHaveBeenCalled();
        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(mocks.setTempo).not.toHaveBeenCalled();
        expect(mocks.setTimeSignature).not.toHaveBeenCalled();
    });

    it('should update setlist index and emit midi.out program change when configured', () => {
        const items = [
            baseItem({
                programChange: { channel: 2, program: 10 },
            }),
        ];
        setlistStoreMock.value = baseState(items, 0);

        const eventBus = injectGoToItem();

        goToItem(0);

        expect(setlistStore.set).toHaveBeenCalled();
        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(eventBus.emit).toHaveBeenCalledWith('midi.out', {
            type: 'programChange',
            channel: 2,
            program: 10,
        });
        expect(mocks.setTempo).not.toHaveBeenCalled();
        expect(mocks.setTimeSignature).not.toHaveBeenCalled();
    });

    it('should not emit program change when item has no programChange', () => {
        const items = [baseItem({ programChange: null })];
        setlistStoreMock.value = baseState(items, 0);

        const eventBus = injectGoToItem();

        goToItem(0);

        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(mocks.setTempo).not.toHaveBeenCalled();
        expect(mocks.setTimeSignature).not.toHaveBeenCalled();
    });

    it('should call setTempo when item bpm is set', () => {
        const items = [baseItem({ bpm: 140 })];
        setlistStoreMock.value = baseState(items, 0);

        injectGoToItem();

        goToItem(0);

        expect(mocks.setTempo).toHaveBeenCalledWith({ bpm: 140 });
        expect(mocks.setTimeSignature).not.toHaveBeenCalled();
    });

    it('should call setTimeSignature when item time signature is set', () => {
        const items = [baseItem({ timeSignature: { numerator: 3, denominator: 4 } })];
        setlistStoreMock.value = baseState(items, 0);

        injectGoToItem();

        goToItem(0);

        expect(mocks.setTimeSignature).toHaveBeenCalledWith(3, 4);
        expect(mocks.setTempo).not.toHaveBeenCalled();
    });

    it('should call both transport use cases when bpm and time signature are set', () => {
        const items = [
            baseItem({
                bpm: 140,
                timeSignature: { numerator: 3, denominator: 4 },
            }),
        ];
        setlistStoreMock.value = baseState(items, 0);

        injectGoToItem();

        goToItem(0);

        expect(mocks.setTempo).toHaveBeenCalledWith({ bpm: 140 });
        expect(mocks.setTimeSignature).toHaveBeenCalledWith(3, 4);
    });

    it('should still update index and apply time signature when setTempo refuses with TempoRampWrite', () => {
        const items = [
            baseItem({
                id: 'a',
                bpm: 140,
                timeSignature: { numerator: 3, denominator: 4 },
            }),
            baseItem({ id: 'b' }),
        ];
        setlistStoreMock.value = baseState(items, 1);

        mocks.setTempo.mockImplementation(() => {
            throw createAppError('TempoRampWrite', 'Cannot set tempo here', {
                bpm: 140,
                tempoChangeId: 'tc-1',
            });
        });

        injectGoToItem();

        expect(() => goToItem(0)).not.toThrow();
        expect(mocks.setTempo).toHaveBeenCalledWith({ bpm: 140 });
        expect(setlistStore.set).toHaveBeenCalled();
        expect(setlistStore.value?.currentIndex).toBe(0);
        expect(mocks.setTimeSignature).toHaveBeenCalledWith(3, 4);
    });

    it('should rethrow non-TempoRampWrite errors from setTempo and skip time signature', () => {
        const items = [
            baseItem({
                bpm: 140,
                timeSignature: { numerator: 3, denominator: 4 },
            }),
        ];
        setlistStoreMock.value = baseState(items, 0);

        const invalidTempo = createAppError('InvalidTempo', 'Tempo 140 BPM is outside the valid range (20–300)', {
            bpm: 140,
        });
        mocks.setTempo.mockImplementation(() => {
            throw invalidTempo;
        });

        injectGoToItem();

        expect(() => goToItem(0)).toThrow(invalidTempo);
        expect(mocks.setTempo).toHaveBeenCalledWith({ bpm: 140 });
        expect(mocks.setTimeSignature).not.toHaveBeenCalled();
    });
});
