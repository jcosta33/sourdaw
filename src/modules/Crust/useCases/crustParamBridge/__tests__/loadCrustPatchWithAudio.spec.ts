import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

// Controllable engine / persistence sinks. `helpers.ts` wires these at module
// level (no DI), so we intercept them at the module boundary and keep the real
// paramBatcher / encodeCrustValue / findDeviceRefCrust so the cancel-on-load
// behaviour is genuinely exercised. vi.hoisted lifts the shared spies/state so
// the hoisted vi.mock factories below can reference them.
const mocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    persistDeviceParam: vi.fn(),
    loadCrustPatch: vi.fn(),
    trackStore: {
        value: { tracks: [{ id: 'track-1', devices: [{ id: 'device-1', type: 'crust' }] }] },
    },
}));
const { updateDeviceParam, persistDeviceParam } = mocks;

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    persistDeviceParam: mocks.persistDeviceParam,
}));

vi.mock('../../../stores/crustStore', () => ({
    loadCrustPatch: mocks.loadCrustPatch,
}));

import { DEFAULT_CRUST_PATCH } from '../../../models/CrustPatch';
import { createFlushHandlers } from '../createFlushHandlers';
import { paramBatcher, findDeviceRefCrust } from '../helpers';
import { loadCrustPatchWithAudio } from '../loadCrustPatchWithAudio';

describe('loadCrustPatchWithAudio', () => {
    let rafQueue: Array<() => void>;

    beforeEach(() => {
        vi.clearAllMocks();
        paramBatcher.cancelAll();
        rafQueue = [];
        // Capture rAF callbacks so the test drives flush timing deterministically.
        vi.stubGlobal('requestAnimationFrame', (cb: () => void): number => {
            rafQueue.push(cb);
            return rafQueue.length;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
            rafQueue[id - 1] = () => {};
        });
    });

    afterEach(() => {
        paramBatcher.cancelAll();
        vi.unstubAllGlobals();
    });

    function runPendingRaf(): void {
        const queued = rafQueue;
        rafQueue = [];
        for (const cb of queued) {
            cb();
        }
    }

    it('should export loadCrustPatchWithAudio', () => {
        expect(loadCrustPatchWithAudio).toBeDefined();
        expect(typeof loadCrustPatchWithAudio).toBe('function');
    });

    it('does not push scrollSpeed (UI-only metadata) to the audio engine', () => {
        const patch = { ...DEFAULT_CRUST_PATCH, scrollSpeed: 'fast' as const };

        loadCrustPatchWithAudio(DEVICE_ID, patch);

        const sawScrollSpeed = updateDeviceParam.mock.calls.some(([, , key]) => key === 'scrollSpeed');
        expect(sawScrollSpeed).toBe(false);
        const persistedScrollSpeed = persistDeviceParam.mock.calls.some(([, key]) => key === 'scrollSpeed');
        expect(persistedScrollSpeed).toBe(false);
        // Sanity: a real audio param still went through.
        expect(updateDeviceParam).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, 'gain', expect.anything());
    });

    it('cancels a pending drag-flush so it cannot overwrite the loaded preset value', () => {
        const ref = findDeviceRefCrust(DEVICE_ID);
        if (!ref) {
            throw new Error('expected device ref in test setup');
        }
        const { flushParam } = createFlushHandlers({ updateDeviceParam, persistDeviceParam });

        // A knob drag scheduled a rAF flush carrying a stale gain value but the
        // frame has not fired yet.
        paramBatcher.schedule(`${DEVICE_ID}:gain`, { ref, key: 'gain', value: 99 }, flushParam);
        expect(paramBatcher.pendingSize).toBe(1);

        // The preset carries a different gain; load applies it immediately.
        const patch = { ...DEFAULT_CRUST_PATCH, gain: 3 };
        loadCrustPatchWithAudio(DEVICE_ID, patch);

        // The preset gain reached the engine immediately.
        expect(updateDeviceParam).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, 'gain', 3);

        // The stale drag flush must have been cancelled, not merely queued.
        expect(paramBatcher.pendingSize).toBe(0);
        updateDeviceParam.mockClear();

        // Driving any still-queued frame must NOT deliver the stale value 99.
        runPendingRaf();
        const sawStaleGain = updateDeviceParam.mock.calls.some(([, , key, value]) => key === 'gain' && value === 99);
        expect(sawStaleGain).toBe(false);
    });
});
