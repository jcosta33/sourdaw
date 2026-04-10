import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type LoopStationState } from '#/modules/Transport/stores/loopStationStore';
import { createSlot } from './createSlot';

describe('createSlot', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('appends a slot when store state exists', () => {
        const set = vi.fn();
        const baseState: LoopStationState = {
            slots: [],
            sceneCount: 8,
            activeScene: 0,
            armed: false,
            syncToTransport: true,
            fixedLoopLength: 0,
        };
        injectDependencies(createSlot, {
            loopStationStore: {
                value: baseState,
                set,
            } as never,
        });

        createSlot('track-1', 0, 0);

        expect(set).toHaveBeenCalledTimes(1);
        const nextState = set.mock.calls[0]![0] as LoopStationState;
        expect(nextState.slots).toHaveLength(1);
        expect(nextState.slots[0]!.trackId).toBe('track-1');
    });
});
