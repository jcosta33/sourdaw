import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopSlot, type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { clearSlot } from './clearSlot';

describe('clearSlot', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('clears layers on the matching slot id', () => {
        const set = vi.fn();
        const slot: LoopSlot = {
            id: 'slot-a',
            trackId: 't1',
            row: 0,
            column: 0,
            state: 'playing',
            lengthBeats: 4,
            layers: [{ id: 'L1', layerIndex: 0, recordedAt: '', muted: false, volume: 1 }],
            loopCount: 1,
            volume: 1,
            quantize: true,
            fadeBeats: 0.125,
        };
        const baseState: LoopStationState = {
            slots: [slot],
            sceneCount: 8,
            activeScene: 0,
            armed: false,
            syncToTransport: true,
            fixedLoopLength: 0,
        };
        injectDependencies(clearSlot, {
            loopStationStore: {
                value: baseState,
                set,
            } as never,
        });

        clearSlot('slot-a');

        expect(set).toHaveBeenCalledTimes(1);
        const next = set.mock.calls[0]![0] as LoopStationState;
        expect(next.slots[0]!.state).toBe('empty');
        expect(next.slots[0]!.layers).toHaveLength(0);
    });
});
