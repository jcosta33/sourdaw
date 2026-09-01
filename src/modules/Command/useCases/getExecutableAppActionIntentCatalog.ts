import { getExecutableCommandRegistrations } from './getExecutableCommandRegistrations';

const MAX_CATALOG_PAGE_SIZE = 8;
const MAX_INTENT_LENGTH = 512;
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
    intent: string;
    resultSetFingerprint: string;
    offset: number;
};

type IntentCatalogEntry = {
    name: string;
    purpose: string;
    semanticCategories: string[];
};

function words(value: string): string[] {
    return (value.match(/[A-Z]?[a-z]+|\d+/g) ?? []).map((word) => word.toLowerCase());
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

function normalizedIntent(value: string | undefined): string {
    if (value === undefined) {
        return '';
    }
    if (value.length === 0 || value.length > MAX_INTENT_LENGTH) {
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
            !('intent' in value) ||
            !('resultSetFingerprint' in value) ||
            !('offset' in value) ||
            value.schemaVersion !== 1 ||
            typeof value.intent !== 'string' ||
            typeof value.resultSetFingerprint !== 'string' ||
            typeof value.offset !== 'number' ||
            !Number.isSafeInteger(value.offset) ||
            value.offset < 0
        ) {
            return null;
        }
        return {
            schemaVersion: 1,
            intent: value.intent,
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

function pageOffset(input: {
    cursor: string | undefined;
    intent: string;
    resultSetFingerprint: string;
    total: number;
}): number {
    if (input.cursor === undefined) {
        return 0;
    }
    const cursor = decodeCursor(input.cursor);
    if (
        cursor === null ||
        cursor.intent !== input.intent ||
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
    const purpose = entry.purpose.toLowerCase();
    return terms.reduce((score, term) => {
        if (name.includes(term)) {
            return score + 4;
        }
        if (categories.has(term)) {
            return score + 3;
        }
        return purpose.includes(term) ? score + 1 : score;
    }, 0);
}

export function getExecutableAppActionIntentCatalog(input: { intent?: string; page?: IntentCatalogPage }) {
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
        .filter(({ score }) => intent.length === 0 || score > 0)
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ entry }) => entry);
    const names = entries.map((entry) => entry.name);
    const fingerprint = resultSetFingerprint(names);
    const offset = pageOffset({
        cursor: input.page?.cursor,
        intent,
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
                ? encodeCursor({ schemaVersion: 1, intent, resultSetFingerprint: fingerprint, offset: nextOffset })
                : null,
        page: { limit, offset, total: entries.length },
        truncated: nextOffset < entries.length,
    };
}
