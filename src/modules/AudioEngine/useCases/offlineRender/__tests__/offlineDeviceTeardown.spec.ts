/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Offline render device teardown — SPEC-offline-live-collapse AC-2
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **What this asserts.** An offline render destroys every device strategy it
 * constructed, on the success path, the failure path and the cancellation path.
 *
 * **Why the paths are enumerated separately.** They are three different exits
 * from the same function and only the first one is reachable by a test that
 * renders happily. A teardown placed after the returned buffer satisfies the
 * success case and leaks on the other two, which is the shape the leak took
 * before it was a `finally` at all — and a render that times out or is
 * cancelled has built exactly as many devices as one that finished.
 *
 * **Limit.** These are stubbed strategies, so this proves the teardown *runs*,
 * not that a real wasm node returns its telemetry slot. Sixty-five real
 * allocations need real wasm nodes, which no Vitest spec can build; the pool
 * arithmetic itself is pinned directly against `TelemetryAllocator` in
 * `engine/__tests__/telemetryAllocator.spec.ts`, and the end-to-end occupancy
 * sweep belongs to AC-0's browser harness, which this phase did not land.
 */

import { describe, expect, it, vi } from 'vitest';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { destroyOfflineDeviceStrategies } from '../destroyOfflineDeviceStrategies';

type StubEntry = DeviceNodeEntry & { strategy: { destroy: ReturnType<typeof vi.fn> } };

function entry(deviceId: string, deviceType: string, destroy = vi.fn()): StubEntry {
    return {
        deviceId,
        deviceType,
        node: { inputNode: {}, outputNode: {}, nodes: [] },
        strategy: { destroy },
    } as unknown as StubEntry;
}

describe('destroyOfflineDeviceStrategies', () => {
    it('destroys every strategy on every track of the render', () => {
        const gluten = entry('gluten-1', 'gluten');
        const grinder = entry('grinder-1', 'grinder');
        const proof = entry('proof-1', 'proof');

        destroyOfflineDeviceStrategies(
            new Map([
                ['track-1', [gluten, grinder]],
                ['track-2', [proof]],
            ])
        );

        expect(gluten.strategy.destroy).toHaveBeenCalledTimes(1);
        expect(grinder.strategy.destroy).toHaveBeenCalledTimes(1);
        expect(proof.strategy.destroy).toHaveBeenCalledTimes(1);
    });

    it('carries on past a device that throws, so one bad node cannot strand the rest', () => {
        const thrower = entry(
            'bacteria-1',
            'bacteria',
            vi.fn(() => {
                throw new Error('worklet already detached');
            })
        );
        const survivor = entry('crust-1', 'crust');

        destroyOfflineDeviceStrategies(new Map([['track-1', [thrower, survivor]]]));

        expect(survivor.strategy.destroy).toHaveBeenCalledTimes(1);
    });

    it('tolerates a strategy that declares no destroy', () => {
        const noDestroy = { deviceId: 'x', deviceType: 'builtin-gain', node: {}, strategy: {} };

        expect(() =>
            destroyOfflineDeviceStrategies(new Map([['track-1', [noDestroy as unknown as DeviceNodeEntry]]]))
        ).not.toThrow();
    });
});
