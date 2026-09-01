import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';
import {
    getExecutableAppActionIntentCatalogUnicodeLength,
    MAX_EXECUTABLE_APP_ACTION_INTENT_CATALOG_INTENT_LENGTH,
} from './getExecutableAppActionIntentCatalogUnicodeLength';

const MAX_CATALOG_PAGE_SIZE = 8;
const MAX_CURSOR_LENGTH = 2048;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;
const GRAMMATICAL_QUERY_STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'at',
    'by',
    'for',
    'from',
    'in',
    'into',
    'of',
    'on',
    'or',
    'the',
    'to',
    'with',
]);
const SEMANTIC_CATEGORY_NOISE_WORDS = new Set([
    ...GRAMMATICAL_QUERY_STOP_WORDS,
    'existing',
    'immediately',
    'new',
    'one',
]);

type IntentCatalogPage = { cursor?: string; limit?: number };

type IntentCatalogCursor = {
    schemaVersion: 1;
    intentFingerprint: string;
    resultSetFingerprint: string;
    offset: number;
};

type IntentCatalogEntry = {
    name: string;
    purpose: string;
    semanticCategories: string[];
};

function words(value: string): string[] {
    return (
        value
            .normalize('NFKC')
            .replaceAll(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
            .replaceAll(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
            .toLowerCase()
            .match(/[\p{L}\p{N}]+/gu) ?? []
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function semanticCategories(input: {
    actionType: string;
    intentPhrases: readonly string[];
    targetCapabilities: readonly string[];
}): string[] {
    const candidates = [
        ...words(input.actionType),
        ...input.intentPhrases.flatMap(words),
        ...input.targetCapabilities.flatMap(words),
    ];
    return ['operation', ...new Set(candidates.filter((word) => !SEMANTIC_CATEGORY_NOISE_WORDS.has(word)))].slice(0, 8);
}

function normalizedIntent(value: string): string {
    if (typeof value !== 'string') {
        throw new TypeError('Command catalog intent does not match the strict catalog contract.');
    }
    const length = getExecutableAppActionIntentCatalogUnicodeLength(value);
    if (length === 0 || length > MAX_EXECUTABLE_APP_ACTION_INTENT_CATALOG_INTENT_LENGTH) {
        throw new Error('Command catalog intent does not match the strict catalog contract.');
    }
    const terms = words(value).filter((word) => !GRAMMATICAL_QUERY_STOP_WORDS.has(word));
    if (terms.length === 0) {
        throw new Error('Command catalog intent does not match the strict catalog contract.');
    }
    return terms.join(' ');
}

function encodeCursor(cursor: IntentCatalogCursor): string {
    const bytes = new TextEncoder().encode(JSON.stringify(cursor));
    let binary = '';
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decodeCursor(cursor: string): IntentCatalogCursor | null {
    if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !CURSOR_PATTERN.test(cursor)) {
        return null;
    }
    try {
        const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/');
        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        if (
            !isRecord(value) ||
            Object.keys(value).length !== 4 ||
            !('schemaVersion' in value) ||
            !('intentFingerprint' in value) ||
            !('resultSetFingerprint' in value) ||
            !('offset' in value) ||
            value.schemaVersion !== 1 ||
            typeof value.intentFingerprint !== 'string' ||
            typeof value.resultSetFingerprint !== 'string' ||
            typeof value.offset !== 'number' ||
            !Number.isSafeInteger(value.offset) ||
            value.offset < 0
        ) {
            return null;
        }
        return {
            schemaVersion: 1,
            intentFingerprint: value.intentFingerprint,
            resultSetFingerprint: value.resultSetFingerprint,
            offset: value.offset,
        };
    } catch {
        return null;
    }
}

function pageLimit(limit: number | undefined): number {
    if (limit === undefined) {
        return MAX_CATALOG_PAGE_SIZE;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CATALOG_PAGE_SIZE) {
        throw new Error('Command catalog page limit does not match the strict catalog contract.');
    }
    return limit;
}

function resultSetFingerprint(names: readonly string[]): string {
    let hash = 2_166_136_261;
    for (const character of names.join('\u0000')) {
        hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
    }
    return `${String(names.length)}-${String(hash >>> 0)}`;
}

function intentFingerprint(intent: string): string {
    let hash = 2_166_136_261;
    for (const character of intent) {
        hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619);
    }
    return `${String(intent.length)}-${String(hash >>> 0)}`;
}

function pageOffset(input: {
    cursor: string | undefined;
    intentFingerprint: string;
    resultSetFingerprint: string;
    total: number;
}): number {
    if (input.cursor === undefined) {
        return 0;
    }
    const cursor = decodeCursor(input.cursor);
    if (
        cursor === null ||
        cursor.intentFingerprint !== input.intentFingerprint ||
        cursor.resultSetFingerprint !== input.resultSetFingerprint ||
        cursor.offset > input.total
    ) {
        throw new Error('Command catalog cursor does not match the strict catalog contract.');
    }
    return cursor.offset;
}

function intentScore(entry: IntentCatalogEntry, intent: string): number {
    const terms = [...new Set(intent.split(' '))];
    const name = words(entry.name);
    const categories = new Set(entry.semanticCategories);
    const purpose = new Set(words(entry.purpose));
    return terms.reduce((score, term) => {
        const variants = inflectionVariants(term);
        if (variants.some((variant) => name.includes(variant))) {
            return score + 4;
        }
        if (variants.some((variant) => categories.has(variant))) {
            return score + 3;
        }
        return variants.some((variant) => purpose.has(variant)) ? score + 1 : score;
    }, 0);
}

function inflectionVariants(term: string): readonly string[] {
    const variants = new Set([term]);
    const addBaseVariants = (base: string): void => {
        if (base.length === 0) {
            return;
        }
        variants.add(base);
        variants.add(`${base}e`);
        if (/(.)\1$/u.test(base)) {
            variants.add(base.slice(0, -1));
        }
    };
    if (term.endsWith('ies')) {
        variants.add(`${term.slice(0, -3)}y`);
    }
    if (term.endsWith('ing')) {
        addBaseVariants(term.slice(0, -3));
    }
    if (term.endsWith('ed')) {
        addBaseVariants(term.slice(0, -2));
    }
    if (term.endsWith('es')) {
        addBaseVariants(term.slice(0, -2));
    } else if (term.endsWith('s')) {
        addBaseVariants(term.slice(0, -1));
    }
    return [...variants];
}

export function getExecutableAppActionIntentCatalog(input: { intent: string; page?: IntentCatalogPage }) {
    const intent = normalizedIntent(input.intent);
    const entries = getExecutableCommandRegistrations()
        .map((registration, index) => {
            const entry: IntentCatalogEntry = {
                name: registration.actionType,
                purpose: registration.toolDescription,
                semanticCategories: semanticCategories({
                    actionType: registration.actionType,
                    intentPhrases: registration.intentPhrases,
                    targetCapabilities: registration.capabilityChecks.map(({ capability }) => capability),
                }),
            };
            return { entry, index, score: intentScore(entry, intent) };
        })
        .filter(({ score }) => score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ entry }) => entry);
    const names = entries.map((entry) => entry.name);
    const fingerprint = resultSetFingerprint(names);
    const currentIntentFingerprint = intentFingerprint(intent);
    const offset = pageOffset({
        cursor: input.page?.cursor,
        intentFingerprint: currentIntentFingerprint,
        resultSetFingerprint: fingerprint,
        total: names.length,
    });
    const limit = pageLimit(input.page?.limit);
    const items = entries.slice(offset, offset + limit);
    const nextOffset = offset + items.length;

    return {
        schema: 'sourdaw.intent-command-catalog',
        schemaVersion: 1 as const,
        category: 'command-index' as const,
        intent,
        items: structuredClone(items),
        nextCursor:
            nextOffset < entries.length
                ? encodeCursor({
                      schemaVersion: 1,
                      intentFingerprint: currentIntentFingerprint,
                      resultSetFingerprint: fingerprint,
                      offset: nextOffset,
                  })
                : null,
        page: { limit, offset, total: entries.length },
        truncated: nextOffset < entries.length,
    };
}
