import { describe, expect, it } from 'vitest';

import { getExecutableAppActionIntentCatalog } from '../getExecutableAppActionIntentCatalog';
import { getExecutableCommandRegistrations } from '../getExecutableCommandRegistrations';

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

    it('publishes every registered command purpose through its compact index entry', () => {
        for (const registration of getExecutableCommandRegistrations()) {
            const catalog = getExecutableAppActionIntentCatalog({
                intent: registration.actionType,
                page: { limit: 8 },
            });
            const entry = catalog.items.find((item) => item.name === registration.actionType);
            if (entry === undefined) {
                throw new Error(`Expected compact catalog entry for ${registration.actionType}.`);
            }
            expect(entry.purpose).toBe(registration.toolDescription);
        }
    });

    it('rejects a cursor reused with a distinct astral intent that yields the same result set', () => {
        const firstPage = getExecutableAppActionIntentCatalog({ intent: 'operation 𐐀', page: { limit: 1 } });
        const cursor = firstPage.nextCursor;
        if (cursor === null) {
            throw new Error('Expected an intent catalog cursor.');
        }

        expect(() =>
            getExecutableAppActionIntentCatalog({
                intent: 'operation 𐐁',
                page: { cursor, limit: 1 },
            })
        ).toThrow('Command catalog cursor does not match the strict catalog contract.');
    });

    it('accepts a cursor reused with a normalization-equivalent intent', () => {
        const firstPage = getExecutableAppActionIntentCatalog({ intent: 'operation ﬀ', page: { limit: 1 } });
        const cursor = firstPage.nextCursor;
        if (cursor === null) {
            throw new Error('Expected an intent catalog cursor.');
        }

        const nextPage = getExecutableAppActionIntentCatalog({ intent: 'operation ff', page: { cursor, limit: 1 } });

        expect(nextPage.page.offset).toBe(1);
    });

    it('keeps a schema-admitted ligature intent reusable with its cursor', () => {
        const firstPage = getExecutableAppActionIntentCatalog({
            intent: `operation ${'ﬀ'.repeat(502)}`,
            page: { limit: 1 },
        });
        if (firstPage.nextCursor === null) {
            throw new Error('Expected an intent catalog cursor.');
        }

        const nextPage = getExecutableAppActionIntentCatalog({
            intent: firstPage.intent,
            page: { cursor: firstPage.nextCursor, limit: 1 },
        });

        expect(firstPage.intent).toBe(`operation ${'ﬀ'.repeat(502)}`);
        expect(nextPage.page.offset).toBe(1);
    });
});
