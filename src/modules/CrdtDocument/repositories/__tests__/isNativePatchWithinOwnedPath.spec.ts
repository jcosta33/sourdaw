import { describe, expect, it } from 'vitest';

import { isNativePatchWithinOwnedPath } from '../isNativePatchWithinOwnedPath';

const ownedPath = ['slot', 'rows', 'selected'];

describe('native patch ownership', () => {
    it('accepts the owned row and its descendants', () => {
        const before = { slot: { rows: { selected: { values: [1] }, other: {} } } };
        expect(isNativePatchWithinOwnedPath({ action: 'del', path: ownedPath }, ownedPath, before)).toBe(true);
        expect(
            isNativePatchWithinOwnedPath(
                { action: 'put', path: [...ownedPath, 'values', 0], value: 2 },
                ownedPath,
                before
            )
        ).toBe(true);
        expect(
            isNativePatchWithinOwnedPath(
                { action: 'del', path: ['slot', 'rows', 'selected-alternative'] },
                ownedPath,
                before
            )
        ).toBe(false);
    });

    it('refuses to replace a list ancestor to reach the owned row', () => {
        const rows = { action: 'put' as const, path: ['slot', 'rows'], value: {} };
        expect(isNativePatchWithinOwnedPath(rows, ownedPath, { slot: [] })).toBe(false);
    });

    it('allows an absent ancestor to become an empty map', () => {
        const slot = { action: 'put' as const, path: ['slot'], value: {} };
        const rows = { action: 'put' as const, path: ['slot', 'rows'], value: {} };
        expect(isNativePatchWithinOwnedPath(slot, ownedPath, {})).toBe(true);
        expect(isNativePatchWithinOwnedPath(rows, ownedPath, {})).toBe(true);
        expect(isNativePatchWithinOwnedPath(rows, ownedPath, { slot: {} })).toBe(true);
        expect(isNativePatchWithinOwnedPath(rows, ownedPath, { slot: { rows: {} } })).toBe(false);
        expect(isNativePatchWithinOwnedPath({ ...slot, conflict: true }, ownedPath, {})).toBe(false);
        expect(isNativePatchWithinOwnedPath({ ...slot, value: [] }, ownedPath, {})).toBe(false);
        expect(isNativePatchWithinOwnedPath({ ...slot, value: { data: true } }, ownedPath, {})).toBe(false);
    });
});
