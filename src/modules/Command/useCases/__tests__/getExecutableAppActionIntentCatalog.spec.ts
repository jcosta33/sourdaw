import { describe, expect, it } from 'vitest';

import { getExecutableAppActionIntentCatalog } from '../getExecutableAppActionIntentCatalog';
import { getExecutableCommandRegistrations } from '../getExecutableCommandRegistrations';

const SEMANTIC_CATEGORY_NOISE_WORDS = new Set([
    'a',
    'an',
    'and',
    'at',
    'by',
    'existing',
    'for',
    'from',
    'immediately',
    'in',
    'into',
    'new',
    'of',
    'on',
    'one',
    'or',
    'the',
    'to',
    'with',
]);

function normalizedTokens(value: string): string[] {
    return (
        value
            .normalize('NFKC')
            .replaceAll(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
            .replaceAll(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu) ?? []
    );
}

function expectedSemanticCategories(registration: {
    actionType: string;
    intentPhrases: readonly string[];
    capabilityChecks: readonly { capability: string }[];
}): string[] {
    const candidates = [
        ...normalizedTokens(registration.actionType),
        ...registration.intentPhrases.flatMap(normalizedTokens),
        ...registration.capabilityChecks.flatMap(({ capability }) => normalizedTokens(capability)),
    ];
    return ['operation', ...new Set(candidates.filter((token) => !SEMANTIC_CATEGORY_NOISE_WORDS.has(token)))].slice(
        0,
        8
    );
}

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

    it.each([
        ['copies', 'copyMidiArticulations'],
        ['moving clip', 'moveClip'],
        ['deleted marker', 'removeMarker'],
        ['removes marker', 'removeMarker'],
        ['stops playback', 'stopPlayback'],
        ['stopping playback', 'stopPlayback'],
        ['stopped playback', 'stopPlayback'],
    ] as const)('ranks inflected intent %s to %s', (intent, actionType) => {
        const catalog = getExecutableAppActionIntentCatalog({ intent, page: { limit: 1 } });

        expect(catalog.items[0]?.name).toBe(actionType);
    });

    it('ranks name and category matches ahead of purpose-only matches for mixed queries', () => {
        const catalog = getExecutableAppActionIntentCatalog({ intent: 'classify clip', page: { limit: 8 } });
        expect(catalog.items[0]).toMatchObject({
            name: 'addClip',
            semanticCategories: expect.arrayContaining(['clip']),
        });
    });

    it('publishes every registered command as its canonical compact index entry', () => {
        for (const registration of getExecutableCommandRegistrations()) {
            const catalog = getExecutableAppActionIntentCatalog({
                intent: registration.actionType,
                page: { limit: 8 },
            });
            const entry = catalog.items.find((item) => item.name === registration.actionType);
            if (entry === undefined) {
                throw new Error(`Expected compact catalog entry for ${registration.actionType}.`);
            }
            expect(entry).toEqual({
                name: registration.actionType,
                purpose: registration.toolDescription,
                semanticCategories: expectedSemanticCategories(registration),
            });
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
