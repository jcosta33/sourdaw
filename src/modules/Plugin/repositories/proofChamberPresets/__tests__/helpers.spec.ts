import { describe, it, expect, beforeEach } from 'vitest';

import { DEFAULT_PARAMS } from '../../../models/ProofChamberState';
import { deleteUserPreset } from '../deleteUserPreset';
import { FACTORY_PRESETS, getUserPresets } from '../helpers';
import { saveUserPreset } from '../saveUserPreset';

const STORAGE_KEY = 'proof-chamber-user-presets';

describe('FACTORY_PRESETS', () => {
    it('should use unique ids across factory presets', () => {
        const ids = FACTORY_PRESETS.map((param) => param.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('should only use supported preset categories', () => {
        for (const param of FACTORY_PRESETS) {
            expect(['hall', 'room', 'plate', 'spring', 'creative', 'user']).toContain(param.category);
        }
    });
});

describe('getUserPresets', () => {
    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('should return an empty array when storage is empty', () => {
        expect(getUserPresets()).toEqual([]);
    });

    it('should return stored presets when JSON is valid', () => {
        const row = [
            {
                id: 'user-1',
                name: 'Mine',
                category: 'user' as const,
                params: DEFAULT_PARAMS,
            },
        ];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(row));
        expect(getUserPresets()).toEqual(row);
    });

    it('should return an empty array when JSON is invalid', () => {
        localStorage.setItem(STORAGE_KEY, 'not-json');
        expect(getUserPresets()).toEqual([]);
    });

    it('should return an empty array when stored JSON is a non-array object', () => {
        // Regression: a non-array localStorage value must not be returned as-is,
        // otherwise callers that .push / .filter on the result throw TypeError.
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
        expect(getUserPresets()).toEqual([]);
    });
});

describe('user preset callers tolerate a non-array stored value', () => {
    beforeEach(() => {
        localStorage.removeItem(STORAGE_KEY);
    });

    it('saveUserPreset should not throw when storage holds a non-array object', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
        expect(() => saveUserPreset('Mine', DEFAULT_PARAMS)).not.toThrow();

        const stored = getUserPresets();
        expect(stored).toHaveLength(1);
        expect(stored[0].name).toBe('Mine');
    });

    it('deleteUserPreset should not throw when storage holds a non-array object', () => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
        expect(() => deleteUserPreset('user-1')).not.toThrow();
        expect(getUserPresets()).toEqual([]);
    });
});
