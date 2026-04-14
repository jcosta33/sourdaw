import { describe, it, expect, beforeEach } from 'vitest';
import { loopStationStore } from '../../../stores/loopStationStore';
import { toggleSync } from '../toggleSync';

describe('toggleSync', () => {
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

    it('should flip syncToTransport when state exists', () => {
        toggleSync();

        expect(loopStationStore.value?.syncToTransport).toBe(false);
    });

    it('should not throw when the loop station store is null', () => {
        loopStationStore.set(null);
        expect(() => toggleSync()).not.toThrow();
    });
});
