import { describe, expect, it } from 'vitest';

import { type DeviceStateValue } from '../Track';
import { readPlannedDeviceOwnerSource } from '../readPlannedDeviceOwnerSource';

function source() {
    return {
        id: 'owner',
        devices: [
            {
                id: 'device',
                type: 'fermenter',
                name: 'Fermenter',
                bypassed: false,
                parameterValues: { filterCutoff: 600 },
            },
        ],
    };
}

describe('readPlannedDeviceOwnerSource', () => {
    it('preserves absence, explicit false and empty external fields without defaulting', () => {
        expect(readPlannedDeviceOwnerSource(source())).toEqual(source());
        const explicit = { ...source(), frozen: false };
        Object.assign(explicit.devices[0]!, { externalPluginId: '', externalInstanceId: '', externalStateChunk: '' });
        expect(readPlannedDeviceOwnerSource(explicit)).toEqual(explicit);
    });

    it('rejects malformed current owner fields instead of supplying defaults', () => {
        expect(readPlannedDeviceOwnerSource({ id: 'owner' })).toBeNull();
        expect(readPlannedDeviceOwnerSource({ ...source(), frozen: null })).toBeNull();
        const invalid = source();
        invalid.devices[0]!.parameterValues.filterCutoff = Number.NaN;
        expect(readPlannedDeviceOwnerSource(invalid)).toBeNull();
    });

    it('detaches opaque JSON state while preserving every own key', () => {
        const original = source();
        const array = [null, false, 3];
        const data = Object.fromEntries<DeviceStateValue>([
            ['__proto__', { retained: true }],
            ['nested', Object.fromEntries([['__proto__', 7]])],
            ['array', array],
        ]);
        Object.assign(original.devices[0]!, { deviceState: { version: 1, data } });
        const parsed = readPlannedDeviceOwnerSource(original);
        const chunk = parsed?.devices[0]?.deviceState;
        expect(chunk?.data).toEqual(data);
        expect(Object.hasOwn(chunk?.data ?? {}, '__proto__')).toBe(true);
        expect(chunk?.data).not.toBe(data);
        array.push(4);
        expect(chunk?.data.array).toEqual([null, false, 3]);
    });
});
