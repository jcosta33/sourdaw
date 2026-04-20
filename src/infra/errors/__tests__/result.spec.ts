import { describe, it, expect } from 'vitest';

import { ok, err, isOk, isErr, map, mapError, flatMap, match, unwrapOr, fromNullable, tryCatch } from '../result';

describe('Result', () => {
    describe('ok and err', () => {
        it('creates Ok instances', () => {
            const result = ok(42);
            expect(result).toEqual({ ok: true, value: 42 });
        });

        it('creates Err instances', () => {
            const result = err('Error');
            expect(result).toEqual({ ok: false, error: 'Error' });
        });
    });

    describe('isOk and isErr', () => {
        it('identifies Ok correctly', () => {
            expect(isOk(ok(42))).toBe(true);
            expect(isOk(err('Error'))).toBe(false);
        });

        it('identifies Err correctly', () => {
            expect(isErr(err('Error'))).toBe(true);
            expect(isErr(ok(42))).toBe(false);
        });
    });

    describe('map', () => {
        it('transforms the value if Ok', () => {
            const result = map(ok(2), (x) => x * 2);
            expect(result).toEqual(ok(4));
        });

        it('leaves Err unchanged', () => {
            const result = map(err('Error'), (x: number) => x * 2);
            expect(result).toEqual(err('Error'));
        });
    });

    describe('mapError', () => {
        it('transforms the error if Err', () => {
            const result = mapError(err('Error'), (e) => `${e}!`);
            expect(result).toEqual(err('Error!'));
        });

        it('leaves Ok unchanged', () => {
            const result = mapError(ok(42), (e: string) => `${e}!`);
            expect(result).toEqual(ok(42));
        });
    });

    describe('flatMap', () => {
        it('chains Ok results', () => {
            const result = flatMap(ok(2), (x) => ok(x * 2));
            expect(result).toEqual(ok(4));
        });

        it('chains to Err result', () => {
            const result = flatMap(ok(2), () => err('Error'));
            expect(result).toEqual(err('Error'));
        });

        it('leaves initial Err unchanged', () => {
            const result = flatMap(err('Error'), (x: number) => ok(x * 2));
            expect(result).toEqual(err('Error'));
        });
    });

    describe('match', () => {
        it('executes ok branch for Ok', () => {
            const result = match(ok(42), {
                ok: (v) => v.toString(),
                err: (e: string) => e,
            });
            expect(result).toBe('42');
        });

        it('executes err branch for Err', () => {
            const result = match(err('Error!'), {
                ok: (v: number) => v.toString(),
                err: (e) => e,
            });
            expect(result).toBe('Error!');
        });
    });

    describe('unwrapOr', () => {
        it('returns value for Ok', () => {
            expect(unwrapOr(ok(42), 0)).toBe(42);
        });

        it('returns fallback for Err', () => {
            expect(unwrapOr(err('Error'), 0)).toBe(0);
        });
    });

    describe('fromNullable', () => {
        it('returns Ok for non-null values', () => {
            expect(fromNullable(42, () => 'Error')).toEqual(ok(42));
            expect(fromNullable('', () => 'Error')).toEqual(ok(''));
            expect(fromNullable(0, () => 'Error')).toEqual(ok(0));
            expect(fromNullable(false, () => 'Error')).toEqual(ok(false));
        });

        it('returns Err for null or undefined', () => {
            expect(fromNullable(null, () => 'Error')).toEqual(err('Error'));
            expect(fromNullable(undefined, () => 'Error')).toEqual(err('Error'));
        });
    });

    describe('tryCatch', () => {
        it('returns Ok if function succeeds', () => {
            const result = tryCatch(
                () => 42,
                (e) => String(e)
            );
            expect(result).toEqual(ok(42));
        });

        it('returns Err if function throws', () => {
            const result = tryCatch(
                () => {
                    throw new Error('Boom');
                },
                (e) => (e instanceof Error ? e.message : 'Unknown')
            );
            expect(result).toEqual(err('Boom'));
        });
    });
});
