import { describe, it, expect, vi, beforeEach } from 'vitest';

import { loopStationStore, type LoopStationState } from '../../../stores/loopStationStore';
import { triggerSlot } from '../triggerSlot';

vi.mock('../../../stores/loopStationStore', () => ({
    loopStationStore: { value: null, set: vi.fn() },
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
        loopStationStore.value = {
            ...baseState(),
            slots: [makeSlot({ layers: [] })],
        } as never;
        triggerSlot('s1');
        expect(loopStationStore.set).not.toHaveBeenCalled();
    });

    it('sets the slot to playing when layers exist', () => {
        loopStationStore.value = {
            ...baseState(),
            slots: [
                makeSlot({
                    layers: [{ id: 'L', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                    state: 'stopped',
                }),
            ],
        } as never;
        triggerSlot('s1');
        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('playing');
    });

    it('no-ops for an unknown slot id', () => {
        loopStationStore.value = baseState() as never;
        triggerSlot('missing');
        expect(loopStationStore.set).not.toHaveBeenCalled();
    });
});
