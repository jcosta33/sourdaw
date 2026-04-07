import { describe, it, expect } from 'vitest';
import { ok, err, isOk, isErr, map, mapError, flatMap, match, unwrapOr, fromNullable, tryCatch } from './result';

describe('Result', () => {
    it('ok() and err() create the correct discriminated shapes', () => {
        const o = ok(123);
        expect(o.ok).toBe(true);
        expect((o as any).value).toBe(123);

        const e = err('failed');
        expect(e.ok).toBe(false);
        expect((e as any).error).toBe('failed');
    });

    it('isOk and isErr work correctly', () => {
        expect(isOk(ok(1))).toBe(true);
        expect(isOk(err(1))).toBe(false);
        
        expect(isErr(ok(1))).toBe(false);
        expect(isErr(err(1))).toBe(true);
    });

    it('map() transforms Ok only', () => {
        expect(map(ok(1), x => x * 2)).toEqual(ok(2));
        expect(map(err('e'), (x: any) => x * 2)).toEqual(err('e'));
    });

    it('mapError() transforms Err only', () => {
        expect(mapError(ok(1), x => x + '!')).toEqual(ok(1));
        expect(mapError(err('e'), x => x + '!')).toEqual(err('e!'));
    });

    it('flatMap() chains correctly', () => {
        expect(flatMap(ok(1), x => ok(x * 2))).toEqual(ok(2));
        expect(flatMap(ok(1), x => err('e'))).toEqual(err('e'));
        expect(flatMap(err('e'), (x: any) => ok(x * 2))).toEqual(err('e'));
    });

    it('match() dispatches correctly', () => {
        expect(match(ok(1), { ok: x => x * 2, err: () => 0 })).toBe(2);
        expect(match(err('e'), { ok: (x: any) => x * 2, err: e => e + '!' })).toBe('e!');
    });

    it('unwrapOr() returns value for Ok and fallback for Err', () => {
        expect(unwrapOr(ok(1), 0)).toBe(1);
        expect(unwrapOr(err('e'), 0)).toBe(0);
    });

    it('fromNullable() produces Err for nullish values', () => {
        expect(fromNullable(1, () => 'e')).toEqual(ok(1));
        expect(fromNullable(null, () => 'e')).toEqual(err('e'));
        expect(fromNullable(undefined, () => 'e')).toEqual(err('e'));
    });

    it('tryCatch() captures thrown errors', () => {
        expect(tryCatch(() => 1, () => 'e')).toEqual(ok(1));
        expect(tryCatch(() => { throw new Error('boom'); }, e => (e as Error).message)).toEqual(err('boom'));
    });
});