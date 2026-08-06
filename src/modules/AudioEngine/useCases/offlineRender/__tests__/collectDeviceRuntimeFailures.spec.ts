import { describe, expect, it } from 'vitest';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { collectDeviceRuntimeFailures } from '../collectDeviceRuntimeFailures';

function makeEntry(overrides: Partial<DeviceNodeEntry['strategy']> = {}): DeviceNodeEntry {
    return {
        device: { id: 'd1' },
        strategy: {
            connect: () => {},
            disconnect: () => {},
            ...overrides,
        },
    } as unknown as DeviceNodeEntry;
}

describe('collectDeviceRuntimeFailures', () => {
    it('returns empty arrays when no entries have runtime failures or health checks', () => {
        const map = new Map<string, readonly DeviceNodeEntry[]>([['t1', [makeEntry()]]]);
        const result = collectDeviceRuntimeFailures(map);
        expect(result.runtimeFailures).toEqual([]);
        expect(result.runtimeHealthChecks).toEqual([]);
    });

    it('collects runtimeFailure promises from entries that have them', () => {
        const failure = Promise.reject(new Error('boom'));
        const map = new Map<string, readonly DeviceNodeEntry[]>([['t1', [makeEntry({ runtimeFailure: failure })]]]);
        const result = collectDeviceRuntimeFailures(map);
        expect(result.runtimeFailures).toHaveLength(1);
        expect(result.runtimeFailures[0]).toBe(failure);
        // Prevent unhandled rejection
        failure.catch(() => undefined);
    });

    it('collects runtimeHealthCheck functions from entries that have them', () => {
        const healthCheck = async () => undefined;
        const map = new Map<string, readonly DeviceNodeEntry[]>([
            ['t1', [makeEntry({ runtimeHealthCheck: healthCheck })]],
        ]);
        const result = collectDeviceRuntimeFailures(map);
        expect(result.runtimeHealthChecks).toHaveLength(1);
        expect(result.runtimeHealthChecks[0]).toBe(healthCheck);
    });

    it('aggregates across multiple tracks and multiple entries per track', () => {
        const f1 = Promise.reject(new Error('a'));
        const f2 = Promise.reject(new Error('b'));
        const hc1 = async () => undefined;
        const hc2 = async () => undefined;
        const map = new Map<string, readonly DeviceNodeEntry[]>([
            ['t1', [makeEntry({ runtimeFailure: f1, runtimeHealthCheck: hc1 })]],
            ['t2', [makeEntry({ runtimeFailure: f2 }), makeEntry({ runtimeHealthCheck: hc2 })]],
        ]);
        const result = collectDeviceRuntimeFailures(map);
        expect(result.runtimeFailures).toHaveLength(2);
        expect(result.runtimeHealthChecks).toHaveLength(2);
        f1.catch(() => undefined);
        f2.catch(() => undefined);
    });

    it('handles an empty map', () => {
        const result = collectDeviceRuntimeFailures(new Map());
        expect(result.runtimeFailures).toEqual([]);
        expect(result.runtimeHealthChecks).toEqual([]);
    });
});
