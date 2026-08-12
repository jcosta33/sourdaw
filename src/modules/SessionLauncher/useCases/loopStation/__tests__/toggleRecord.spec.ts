import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopSlot, type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { toggleRecord } from '../toggleRecord';

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

function baseSlot(overrides: Partial<LoopSlot> = {}): LoopSlot {
    return {
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
        ...overrides,
    };
}

describe('toggleRecord', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('advances empty slot to recording', () => {
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

        toggleRecord('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('recording');
    });

    it('does not update the store when no session is loaded', () => {
        loopStationStoreMock.value = null;

        toggleRecord('s1');

        expect(loopStationStore.set).not.toHaveBeenCalled();
    });

    it('leaves other slots untouched when the id does not match', () => {
        const untouched = baseSlot({ id: 's1', state: 'playing' });
        loopStationStoreMock.value = { ...emptyLoopState(), slots: [untouched] };

        toggleRecord('does-not-exist');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]).toEqual(untouched);
    });

    it('moves a recording slot to playing, capturing the first layer and defaulting length to 4 beats', () => {
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            fixedLoopLength: 0,
            slots: [baseSlot({ state: 'recording' })],
        };

        toggleRecord('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        const slot = next.slots[0]!;
        expect(slot.state).toBe('playing');
        expect(slot.layers).toHaveLength(1);
        expect(slot.layers[0]!.layerIndex).toBe(0);
        expect(slot.lengthBeats).toBe(4);
    });

    it('moves a recording slot to playing using the fixed loop length when one is set', () => {
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            fixedLoopLength: 8,
            slots: [baseSlot({ state: 'recording' })],
        };

        toggleRecord('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.lengthBeats).toBe(8);
    });

    it('moves a playing slot to overdubbing without adding a layer', () => {
        const layer = { id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 };
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [baseSlot({ state: 'playing', layers: [layer] })],
        };

        toggleRecord('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('overdubbing');
        expect(next.slots[0]!.layers).toEqual([layer]);
    });

    it('adds a new layer and returns to playing when overdubbing finishes', () => {
        const layer = { id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 };
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [baseSlot({ state: 'overdubbing', layers: [layer] })],
        };

        toggleRecord('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('playing');
        expect(next.slots[0]!.layers).toHaveLength(2);
        expect(next.slots[0]!.layers[1]!.layerIndex).toBe(1);
    });

    it('resumes a stopped slot to playing, keeping its recorded layers', () => {
        const layer = { id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 };
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [baseSlot({ state: 'stopped', layers: [layer] })],
        };

        toggleRecord('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('playing');
        expect(next.slots[0]!.layers).toEqual([layer]);
    });

    it('does not resume a stopped slot with zero layers (stop-during-first-recording leaves a dead cell)', () => {
        // Regression for F5: stopSlot maps recording -> stopped unconditionally,
        // so a slot stopped mid-first-recording is 'stopped' with layers: [].
        // toggleRecord must not promote that to 'playing' — unlike triggerSlot,
        // which already guards on layers.length === 0.
        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [baseSlot({ state: 'stopped', layers: [], lengthBeats: 0 })],
        };

        toggleRecord('s1');

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('stopped');
        expect(next.slots[0]!.layers).toEqual([]);
    });
});
