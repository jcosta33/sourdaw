import { describe, it, expect, beforeEach } from 'vitest';

import { loopStationStore } from '../loopStationStore';

describe('loopStationStore', () => {
    beforeEach(() => {
        loopStationStore.set({
            slots: [],
            sceneCount: 8,
            activeScene: 0,
            armed: false,
            syncToTransport: true,
            fixedLoopLength: 0,
        });
    });

    it('should have initial state', () => {
        expect(loopStationStore.value?.slots).toHaveLength(0);
        expect(loopStationStore.value?.sceneCount).toBe(8);
    });

    it('should update state', () => {
        loopStationStore.update((state) => ({ ...state!, armed: true }));
        expect(loopStationStore.value?.armed).toBe(true);
    });
});
