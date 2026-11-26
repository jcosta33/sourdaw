import { describe, expect, it } from 'vitest';

import { findYeastDevice } from '../findYeastDevice';

describe('findYeastDevice', () => {
    it('returns the first Yeast device and no other type', () => {
        const devices = [
            { id: 'eq', type: 'builtin-eq' },
            { id: 'y1', type: 'yeast' },
            { id: 'y2', type: 'yeast' },
        ];
        expect(findYeastDevice(devices)?.id).toBe('y1');
    });

    it.each(['Yeast', 'YEAST', '', 'external-plugin', 'constructor', '__proto__'])(
        'does not claim a device of type %j',
        (type) => {
            expect(findYeastDevice([{ id: 'd', type }])).toBeUndefined();
        }
    );

    it('returns undefined for an empty device list', () => {
        expect(findYeastDevice([])).toBeUndefined();
    });
});
