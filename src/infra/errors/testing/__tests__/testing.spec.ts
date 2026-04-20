import { describe, it, expect } from 'vitest';

import { ok, err } from '../../result';
import { assertErr } from '../assertErr';
import { assertOk } from '../assertOk';

describe('Testing helpers', () => {
    describe('assertOk', () => {
        it('returns the value if result is Ok', () => {
            const result = ok(42);
            expect(assertOk(result)).toBe(42);
        });

        it('throws an error if result is Err', () => {
            const result = err('Error');
            expect(() => assertOk(result)).toThrow('Expected Ok, got Err: Error');
        });
    });

    describe('assertErr', () => {
        it('returns the error if result is Err', () => {
            const result = err('Error');
            expect(assertErr(result)).toBe('Error');
        });

        it('throws an error if result is Ok', () => {
            const result = ok(42);
            expect(() => assertErr(result)).toThrow('Expected Err, got Ok: 42');
        });
    });
});
