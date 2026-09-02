import { describe, expect, it } from 'vitest';

import { getExecutableAppActionIntentCatalog } from '../getExecutableAppActionIntentCatalog';

describe('getExecutableAppActionIntentCatalog', () => {
    it.each([{} as never, { intent: '' }])('rejects a missing or empty public intent', (input) => {
        expect(() => getExecutableAppActionIntentCatalog(input)).toThrow(
            'Command catalog intent does not match the strict catalog contract.'
        );
    });

    it('uses Unicode code points for the public intent limit', () => {
        expect(() =>
            getExecutableAppActionIntentCatalog({ intent: '𐐀'.repeat(512), page: { limit: 1 } })
        ).not.toThrow();
        expect(() => getExecutableAppActionIntentCatalog({ intent: '𐐀'.repeat(513), page: { limit: 1 } })).toThrow(
            'Command catalog intent does not match the strict catalog contract.'
        );
    });

    it('publishes camel-split semantic categories for lower-camel commands', () => {
        const catalog = getExecutableAppActionIntentCatalog({ intent: 'set tempo', page: { limit: 1 } });

        expect(catalog.items).toEqual([
            expect.objectContaining({ name: 'setTempo', semanticCategories: expect.arrayContaining(['set', 'tempo']) }),
        ]);
    });

    it('requires removeMarker for a deleted marker intent', () => {
        const catalog = getExecutableAppActionIntentCatalog({ intent: 'deleted marker', page: { limit: 1 } });

        expect(catalog.items).toEqual([expect.objectContaining({ name: 'removeMarker' })]);
    });

    it('ranks name and category matches ahead of purpose-only matches for mixed queries', () => {
        const catalog = getExecutableAppActionIntentCatalog({ intent: 'classify clip', page: { limit: 8 } });
        expect(catalog.items[0]).toMatchObject({
            name: 'addClip',
            semanticCategories: expect.arrayContaining(['clip']),
        });
    });

    it('rejects a cursor reused with a distinct astral intent that yields the same result set', () => {
        const firstPage = getExecutableAppActionIntentCatalog({ intent: 'operation 𐐀', page: { limit: 1 } });
        if (firstPage.nextCursor === null) {
            throw new Error('Expected an intent catalog cursor.');
        }

        expect(() =>
            getExecutableAppActionIntentCatalog({
                intent: 'operation 𐐁',
                page: { cursor: firstPage.nextCursor, limit: 1 },
            })
        ).toThrow('Command catalog cursor does not match the strict catalog contract.');
    });
});
