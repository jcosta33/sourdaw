import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loopStationStore, type LoopStationState } from '../../../stores/loopStationStore';
import { triggerSlot } from '../triggerSlot';

const loopStationStoreMock = vi.hoisted(() => ({
    value: null as import('../../../stores/loopStationStore').LoopStationState | null,
    set: vi.fn(),
}));

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: loopStationStoreMock,
}));

function makeSlot(overrides: Partial<LoopStationState['slots'][number]> = {}): LoopStationState['slots'][number] {
    return {
        id: 's1',
        trackId: 't',
        row: 0,
        column: 0,
        state: 'stopped',
        lengthBeats: 0,
        layers: [],
        loopCount: 0,
        volume: 1,
        quantize: true,
        fadeBeats: 0,
        ...overrides,
    };
}

function baseState(): LoopStationState {
    return {
        slots: [],
        sceneCount: 8,
        activeScene: 0,
        armed: false,
        syncToTransport: true,
        fixedLoopLength: 0,
    };
}

describe('triggerSlot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does nothing for a slot with no layers', () => {
        loopStationStoreMock.value = {
            ...baseState(),
            slots: [makeSlot({ layers: [] })],
        };
        triggerSlot('s1');
        expect(loopStationStore.set).not.toHaveBeenCalled();
    });

    it('sets the slot to playing when layers exist', () => {
        loopStationStoreMock.value = {
            ...baseState(),
            slots: [
                makeSlot({
                    layers: [{ id: 'L', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                    state: 'stopped',
                }),
            ],
        };
        triggerSlot('s1');
        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('playing');
    });

    it('no-ops for an unknown slot id', () => {
        loopStationStoreMock.value = baseState();
        triggerSlot('missing');
        expect(loopStationStore.set).not.toHaveBeenCalled();
    });
});
