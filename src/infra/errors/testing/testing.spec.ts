import { describe, it, expect } from 'vitest';
import { assertOk } from './assertOk';
import { assertErr } from './assertErr';
import { ok, err } from '../result';
import { createAppError } from '../createAppError';

describe('Error Testing Helpers', () => {
    it('assertOk() returns value for Ok and throws for Err', () => {
        expect(assertOk(ok(42))).toBe(42);
        expect(() => assertOk(err('failed'))).toThrow(/Expected Ok, but got Err/);
    });

    it('assertErr() returns error for Err and throws for Ok', () => {
        const error = createAppError('TestError', 'Failed');
        expect(assertErr(err(error))).toBe(error);
        expect(() => assertErr(ok(42))).toThrow(/Expected Err, but got Ok/);
    });
});