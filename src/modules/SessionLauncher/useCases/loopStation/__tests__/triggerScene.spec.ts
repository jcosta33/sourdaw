import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type LoopSlot, type LoopStationState } from '../../../stores/loopStationStore';
import { loopStationStore } from '../../../stores/loopStationStore';
import { triggerScene } from '../triggerScene';

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

describe('triggerScene', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sets activeScene', () => {
        loopStationStoreMock.value = emptyLoopState();

        triggerScene(3);

        expect(loopStationStore.set).toHaveBeenCalledWith(expect.objectContaining({ activeScene: 3 }));
    });

    it('does not update the store when no session is loaded', () => {
        loopStationStoreMock.value = null;

        triggerScene(3);

        expect(loopStationStore.set).not.toHaveBeenCalled();
    });

    it('starts the triggered slot, stops other playing slots, and leaves the rest untouched', () => {
        const triggeredWithLayers: LoopSlot = {
            id: 'slot-a',
            trackId: 't1',
            row: 0,
            column: 3,
            state: 'stopped',
            lengthBeats: 4,
            layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
            loopCount: 0,
            volume: 1,
            quantize: true,
            fadeBeats: 0.125,
        };
        const triggeredWithoutLayers: LoopSlot = { ...triggeredWithLayers, id: 'slot-b', state: 'empty', layers: [] };
        const otherColumnPlaying: LoopSlot = { ...triggeredWithLayers, id: 'slot-c', column: 1, state: 'playing' };
        const otherColumnIdle: LoopSlot = { ...triggeredWithLayers, id: 'slot-d', column: 1, state: 'empty' };

        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [triggeredWithLayers, triggeredWithoutLayers, otherColumnPlaying, otherColumnIdle],
        };

        triggerScene(3);

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.activeScene).toBe(3);
        expect(next.slots.find((s) => s.id === 'slot-a')!.state).toBe('playing');
        expect(next.slots.find((s) => s.id === 'slot-b')!.state).toBe('empty');
        expect(next.slots.find((s) => s.id === 'slot-c')!.state).toBe('stopped');
        expect(next.slots.find((s) => s.id === 'slot-d')!.state).toBe('empty');
    });

    it('stops an overdubbing slot in another scene, matching stopAllSlots (F6)', () => {
        // Regression for F6: triggerScene previously demoted only
        // state === 'playing' slots in other columns, leaving an overdubbing
        // slot in a different scene running (red LED) after the switch.
        const overdubbingElsewhere: LoopSlot = {
            id: 'slot-e',
            trackId: 't1',
            row: 0,
            column: 1,
            state: 'overdubbing',
            lengthBeats: 4,
            layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
            loopCount: 0,
            volume: 1,
            quantize: true,
            fadeBeats: 0.125,
        };

        loopStationStoreMock.value = {
            ...emptyLoopState(),
            slots: [overdubbingElsewhere],
        };

        triggerScene(3);

        const next = vi.mocked(loopStationStore.set).mock.calls[0]![0] as LoopStationState;
        expect(next.slots.find((s) => s.id === 'slot-e')!.state).toBe('stopped');
    });
});
