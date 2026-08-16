import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { stopSlot } from '../stopSlot';

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

describe('stopSlot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('marks matching slot stopped', () => {
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                {
                    id: 's1',
                    trackId: 't',
                    row: 0,
                    column: 0,
                    state: 'playing',
                    lengthBeats: 4,
                    layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0.125,
                },
            ],
        };

        stopSlot('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('stopped');
    });

    it('returns a zero-layer slot to empty regardless of its prior state', () => {
        // The Stop button has no disabled guard, so it can fire on an 'empty'
        // slot. Promoting it to 'stopped' lights the amber content LED for a
        // cell holding nothing — the gate is the layer count, not the state.
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                {
                    id: 's1',
                    trackId: 't',
                    row: 0,
                    column: 0,
                    state: 'empty',
                    lengthBeats: 0,
                    layers: [],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0.125,
                },
            ],
        };

        stopSlot('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('empty');
    });

    it('does not update the store when no session is loaded', () => {
        loopStationStoreMock.value = null;

        stopSlot('s1');

        expect(loopStationStore.set).not.toHaveBeenCalled();
    });

    it('discards an unfinished first recording, returning the slot to empty (F5)', () => {
        // Stopping mid-first-recording has captured nothing: toggleRecord only
        // commits a layer when the recording pass ends. Marking the slot
        // 'stopped' left an amber, LED-lit cell holding `layers: []` — a cell
        // claiming content it does not have. Hardware loopers discard it.
        // lengthBeats starts non-zero because a re-recording after undoLastLayer
        // carries the previous take's length — the discard must clear it.
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                {
                    id: 's1',
                    trackId: 't',
                    row: 0,
                    column: 0,
                    state: 'recording',
                    lengthBeats: 4,
                    layers: [],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0.125,
                },
            ],
        };

        stopSlot('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('empty');
        expect(next.slots[0]!.layers).toEqual([]);
        expect(next.slots[0]!.lengthBeats).toBe(0);
    });

    it('keeps committed layers and stops normally when an overdub is interrupted', () => {
        const layer = { id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 };
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [
                {
                    id: 's1',
                    trackId: 't',
                    row: 0,
                    column: 0,
                    state: 'overdubbing',
                    lengthBeats: 4,
                    layers: [layer],
                    loopCount: 0,
                    volume: 1,
                    quantize: true,
                    fadeBeats: 0.125,
                },
            ],
        };

        stopSlot('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('stopped');
        expect(next.slots[0]!.layers).toEqual([layer]);
        expect(next.slots[0]!.lengthBeats).toBe(4);
    });

    it('leaves other slots untouched', () => {
        const other = {
            id: 's2',
            trackId: 't',
            row: 1,
            column: 0,
            state: 'playing' as const,
            lengthBeats: 4,
            layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
            loopCount: 0,
            volume: 1,
            quantize: true,
            fadeBeats: 0.125,
        };
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [{ ...other, id: 's1', state: 'recording' as const, layers: [], lengthBeats: 0 }, other],
        };

        stopSlot('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[1]).toEqual(other);
    });
});
