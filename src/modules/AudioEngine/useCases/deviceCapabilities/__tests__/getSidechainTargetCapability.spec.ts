import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { acceptsSidechainInput } from '../acceptsSidechainInput';
import { getSidechainTargetCapability } from '../getSidechainTargetCapability';

const SIDECHAIN_COMPRESSOR = 'builtin-sidechain-compressor';

const NON_KEYED_TYPES = [
    'builtin-compressor',
    'toaster',
    'builtin-eq',
    'third-party-bass-compressor',
    'faust:sidechain-compressor',
    '',
    'Builtin-Sidechain-Compressor',
    'builtin-sidechain-compressor-x',
    'constructor',
    '__proto__',
];

describe('getSidechainTargetCapability', () => {
    it('projects the canonical built-in compressor sidechain input', () => {
        expect(getSidechainTargetCapability(SIDECHAIN_COMPRESSOR)).toEqual({ targetParameterId: 'threshold' });
    });

    it.each(NON_KEYED_TYPES)('has no sidechain input for %j', (deviceType) => {
        expect(getSidechainTargetCapability(deviceType)).toBeNull();
    });

    it('resolves null for every other built-in device type', () => {
        const keyed = BUILTIN_DEVICE_TYPES.filter((type) => getSidechainTargetCapability(type) !== null);

        expect(keyed).toEqual([SIDECHAIN_COMPRESSOR]);
    });
});

describe('acceptsSidechainInput', () => {
    it('is true only for the sidechain compressor', () => {
        expect(acceptsSidechainInput(SIDECHAIN_COMPRESSOR)).toBe(true);
    });

    it.each(NON_KEYED_TYPES)('is false for %j', (deviceType) => {
        expect(acceptsSidechainInput(deviceType)).toBe(false);
    });
});
