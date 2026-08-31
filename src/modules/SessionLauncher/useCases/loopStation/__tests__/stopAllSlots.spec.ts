import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { stopAllSlots } from '../stopAllSlots';

const loopStationStoreMock = vi.hoisted(() => ({
    value: null as import('../../../stores/loopStationStore').LoopStationState | null,
    set: vi.fn<(state: import('../../../stores/loopStationStore').LoopStationState) => void>(),
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: loopStationStoreMock,
}));

function emptyLoopState(): LoopStationState {
    return {
        slots: [],
        sceneCount: 8,
        activeScene: 0,
        armed: false,
        syncToTransport: true,
        fixedLoopLength: 0,
    };
}

function slotFixture(
    overrides: Partial<LoopStationState['slots'][number]> & Pick<LoopStationState['slots'][number], 'id' | 'state'>
): LoopStationState['slots'][number] {
    return {
        trackId: 't',
        row: 0,
        column: 0,
        lengthBeats: 4,
        layers: [],
        loopCount: 0,
        volume: 1,
        quantize: true,
        fadeBeats: 0.125,
        ...overrides,
    };
}

describe('stopAllSlots', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('stops playing slots', () => {
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                slotFixture({
                    id: 's1',
                    state: 'playing',
                    layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                }),
            ],
        };

        stopAllSlots();

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('stopped');
    });

    it('discards an unfinished first recording, returning the slot to empty', () => {
        // Stop all must match stopSlot: a recording pass with no committed
        // layer has nothing to hold in stopped, so discard to empty and clear
        // lengthBeats (may be non-zero after undoLastLayer + re-record).
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                slotFixture({
                    id: 's1',
                    state: 'recording',
                    lengthBeats: 4,
                    layers: [],
                }),
            ],
        };

        stopAllSlots();

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('empty');
        expect(next.slots[0]!.layers).toEqual([]);
        expect(next.slots[0]!.lengthBeats).toBe(0);
    });

    it('stops recording, playing, and overdubbing among mixed slots and leaves empty alone', () => {
        const emptySibling = slotFixture({
            id: 's-empty',
            state: 'empty',
            lengthBeats: 0,
            layers: [],
        });
        const layer = { id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 };
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                slotFixture({ id: 's-rec', state: 'recording', lengthBeats: 4, layers: [] }),
                slotFixture({ id: 's-play', state: 'playing', layers: [layer] }),
                slotFixture({ id: 's-over', state: 'overdubbing', layers: [layer] }),
                emptySibling,
            ],
        };

        stopAllSlots();

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('empty');
        expect(next.slots[0]!.lengthBeats).toBe(0);
        expect(next.slots[1]!.state).toBe('stopped');
        expect(next.slots[2]!.state).toBe('stopped');
        expect(next.slots[2]!.layers).toEqual([layer]);
        expect(next.slots[3]).toEqual(emptySibling);
    });

    it('does not update the store when no session is loaded', () => {
        loopStationStoreMock.value = null;

        stopAllSlots();

        expect(loopStationStore.set).not.toHaveBeenCalled();
    });
});
