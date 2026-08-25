import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

const TRACK_ID = 'track-1';
const DEVICE_ID = 'device-1';

// Controllable engine / persistence sinks. `helpers.ts` wires these at module
// level (no DI), so we intercept them at the module boundary and keep the real
// paramBatcher / encodeCrustValue so the cancel-on-load behaviour is genuinely
// exercised. vi.hoisted lifts the shared spies/state so the hoisted vi.mock
// factories below can reference them.
const mocks = vi.hoisted(() => ({
    updateDeviceParam: vi.fn(),
    persistDeviceParam: vi.fn(),
    loadCrustPatch: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(() => ({
        status: 'eligible' as const,
        trackId: 'track-1',
        deviceId: 'device-1',
    })),
    trackStore: {
        value: { tracks: [{ id: 'track-1', devices: [{ id: 'device-1', type: 'crust' }] }] },
        subscribe: vi.fn(() => () => {}),
    },
}));
const { updateDeviceParam, persistDeviceParam } = mocks;

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: mocks.updateDeviceParam,
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: mocks.trackStore,
    persistDeviceParam: mocks.persistDeviceParam,
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));

vi.mock('../../../stores/crustStore', () => ({
    loadCrustPatch: mocks.loadCrustPatch,
}));

import { DEFAULT_CRUST_PATCH, type CrustPatch } from '../../../models/CrustPatch';
import { createFlushHandlers } from '../createFlushHandlers';
import { paramBatcher } from '../helpers';
import { loadCrustPatchWithAudio } from '../loadCrustPatchWithAudio';

describe('loadCrustPatchWithAudio', () => {
    let rafQueue: Array<() => void>;

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: TRACK_ID,
            deviceId: DEVICE_ID,
        });
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
        vi.restoreAllMocks();
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
        const { flushParam } = createFlushHandlers({
            updateDeviceParam,
            persistDeviceParam,
            resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
        });

        // A knob drag scheduled a rAF flush carrying a stale gain value but the
        // frame has not fired yet.
        paramBatcher.schedule(`${DEVICE_ID}:gain`, { deviceId: DEVICE_ID, key: 'gain', value: 99 }, flushParam);
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

    it('resolves an out-of-set oversampling factor before the store and the engine see it', () => {
        // 20 is the illegal value under test: it sits inside the declared 1..32,
        // it is reachable in stored data (the pre-declaration Inspector knob
        // stepped by 1, and a learned MIDI CC scales 0..127 across the span),
        // and `CrustOversampleFactor` cannot stop it because a loaded patch is
        // runtime data. The cascade floors it to 16.
        //
        // Before this guard the store kept 20 and the engine was pushed 20 —
        // so `CrustPanel`'s chip row, which lights on `patch.oversampling ===
        // option`, lit nothing while the DSP ran 16x.
        const patch = { ...DEFAULT_CRUST_PATCH, oversampling: 20 as CrustPatch['oversampling'] };

        loadCrustPatchWithAudio(DEVICE_ID, patch);

        // Soft, so a regression reports both sinks rather than stopping at the
        // first. They are two separate writes of the same value and either one
        // slipping is the same desync.
        const storedPatch = mocks.loadCrustPatch.mock.calls.at(0)?.[0] as CrustPatch | undefined;
        expect.soft(storedPatch?.oversampling, 'the store kept a factor the cascade does not build').toBe(16);

        const pushedOversampling = updateDeviceParam.mock.calls
            .filter(([, , key]) => key === 'oversampling')
            .map(([, , , value]) => value);
        expect.soft(pushedOversampling, 'the engine was pushed a factor the cascade does not build').toEqual([16]);
    });

    it('leaves a patch whose oversampling is already a declared factor untouched', () => {
        // The complement, so the guard cannot be "always rewrite to something".
        // 2 is the factor that was unreachable from every Crust surface until
        // this branch, which makes it the one worth pinning as passing through.
        const patch = { ...DEFAULT_CRUST_PATCH, oversampling: 2 as CrustPatch['oversampling'] };

        loadCrustPatchWithAudio(DEVICE_ID, patch);

        expect(mocks.loadCrustPatch).toHaveBeenCalledWith(patch);
        expect(updateDeviceParam).toHaveBeenCalledWith(TRACK_ID, DEVICE_ID, 'oversampling', 2);
    });

    it.each(['missing', 'ineligible'] as const)(
        'rejects a %s owner before patch, cancellation, or engine effects',
        (status) => {
            mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({ status });
            const cancelAll = vi.spyOn(paramBatcher, 'cancelAll');

            loadCrustPatchWithAudio(DEVICE_ID, DEFAULT_CRUST_PATCH);

            expect(mocks.loadCrustPatch).not.toHaveBeenCalled();
            expect(cancelAll).not.toHaveBeenCalled();
            expect(updateDeviceParam).not.toHaveBeenCalled();
            expect(persistDeviceParam).not.toHaveBeenCalled();
        }
    );
});
