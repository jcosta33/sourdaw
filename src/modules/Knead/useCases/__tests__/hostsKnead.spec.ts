import { describe, expect, it } from 'vitest';

import { BUILTIN_DEVICE_TYPES } from '#/utils/builtinDeviceTypes';

import { hostsKnead } from '../hostsKnead';

const chain = (...types: string[]) => types.map((type) => ({ type }));

describe('hostsKnead', () => {
    it.each(['knead', 'Knead', 'KNEAD'])('is true for a chain holding %s', (type) => {
        expect(hostsKnead(chain(type))).toBe(true);
    });

    it('is true when Knead follows another device', () => {
        expect(hostsKnead(chain('builtin-eq', 'external-plugin', 'Knead'))).toBe(true);
    });

    it.each(BUILTIN_DEVICE_TYPES.filter((type) => type !== 'knead'))('is false for the built-in %s', (type) => {
        expect(hostsKnead(chain(type))).toBe(false);
    });

    it.each(['external-plugin', 'faust-zita-rev1', '', 'knead-x', 'constructor', '__proto__'])(
        'is false for %j',
        (type) => {
            expect(hostsKnead(chain(type))).toBe(false);
        }
    );

    it('is false for an empty chain', () => {
        expect(hostsKnead([])).toBe(false);
    });
});
