import { describe, expect, it } from 'vitest';

import { getDeviceContractVersionForCommand } from '../getDeviceContractVersionForCommand';

describe('getDeviceContractVersionForCommand', () => {
    it('derives a stable semantic version from the live built-in descriptor', () => {
        const first = getDeviceContractVersionForCommand('builtin-compressor');
        const second = getDeviceContractVersionForCommand('builtin-compressor');

        expect(first).toMatch(/^descriptor-v1:[0-9a-f]{8}$/);
        expect(second).toBe(first);
        expect(getDeviceContractVersionForCommand('missing-device')).toBeUndefined();
    });
});
