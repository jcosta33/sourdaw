import { describe, expect, it } from 'vitest';

import { toPadStoreUpdate } from '../PadStoreUpdate';

describe('toPadStoreUpdate', () => {
    describe('boolean pad fields (muted, soloed)', () => {
        it('translates a non-zero value to true for muted', () => {
            const result = toPadStoreUpdate({ key: 'muted', value: 1 });
            expect(result).toEqual({ muted: true });
        });

        it('translates zero to false for muted', () => {
            const result = toPadStoreUpdate({ key: 'muted', value: 0 });
            expect(result).toEqual({ muted: false });
        });

        it('translates a non-zero value to true for soloed', () => {
            const result = toPadStoreUpdate({ key: 'soloed', value: 1 });
            expect(result).toEqual({ soloed: true });
        });

        it('translates zero to false for soloed', () => {
            const result = toPadStoreUpdate({ key: 'soloed', value: 0 });
            expect(result).toEqual({ soloed: false });
        });

        it('uses threshold > 0 (0.5 wire value → true)', () => {
            expect(toPadStoreUpdate({ key: 'muted', value: 0.5 })).toEqual({ muted: true });
        });

        it('uses threshold > 0 (negative value → false)', () => {
            expect(toPadStoreUpdate({ key: 'muted', value: -1 })).toEqual({ muted: false });
        });
    });

    describe('string pad fields (engineType, name, color)', () => {
        it('drops engineType writes (returns undefined)', () => {
            const result = toPadStoreUpdate({ key: 'engineType', value: 0 });
            expect(result).toBeUndefined();
        });

        it('drops name writes (returns undefined)', () => {
            const result = toPadStoreUpdate({ key: 'name', value: 1 });
            expect(result).toBeUndefined();
        });

        it('drops color writes (returns undefined)', () => {
            const result = toPadStoreUpdate({ key: 'color', value: 42 });
            expect(result).toBeUndefined();
        });
    });

    describe('numeric pad fields', () => {
        it('passes through tune value unchanged', () => {
            const result = toPadStoreUpdate({ key: 'tune', value: -12 });
            expect(result).toEqual({ tune: -12 });
        });

        it('passes through decay value unchanged', () => {
            const result = toPadStoreUpdate({ key: 'decay', value: 0.7 });
            expect(result).toEqual({ decay: 0.7 });
        });

        it('passes through filterCutoff value unchanged', () => {
            const result = toPadStoreUpdate({ key: 'filterCutoff', value: 20000 });
            expect(result).toEqual({ filterCutoff: 20000 });
        });

        it('passes through zero for a numeric field', () => {
            const result = toPadStoreUpdate({ key: 'tune', value: 0 });
            expect(result).toEqual({ tune: 0 });
        });
    });
});
