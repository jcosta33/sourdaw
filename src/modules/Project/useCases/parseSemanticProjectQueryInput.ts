/**
 * The strict argument contract for one semantic project query.
 *
 * Every caller that carries a query in from outside the application — the
 * agent tool loop, an external client adapter, anything added later — parses
 * it here. The contract is the owner's to state: which keys exist, how long a
 * string may be, how large a page may be asked for. A caller that wrote its
 * own copy would be publishing a second contract under the first one's name,
 * and the two would drift the first time a filter was added.
 *
 * Unknown keys are refused rather than dropped. A caller that misspells a
 * filter is asking a different question from the one it thinks it is asking,
 * and silently answering the wider question is the worse failure.
 */

import {
    MAX_SEMANTIC_QUERY_CURSOR_LENGTH,
    MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH,
    MAX_SEMANTIC_QUERY_PAGE_SIZE,
    MAX_SEMANTIC_QUERY_REVISION_TOKEN_LENGTH,
    SEMANTIC_PROJECT_QUERY_TYPES,
    type SemanticProjectQueryFilters,
    type SemanticProjectQueryInput,
    type SemanticProjectQueryType,
} from '../models/SemanticProjectQuery';

/** Which part of the input failed, so a caller can say so in its own words. */
type SemanticProjectQueryParseFailure = 'arguments' | 'filters' | 'page' | 'revision';

type ParsedSemanticProjectQueryInput =
    | { status: 'valid'; input: SemanticProjectQueryInput }
    | { status: 'invalid'; reason: SemanticProjectQueryParseFailure };

type QueryPage = NonNullable<SemanticProjectQueryInput['page']>;

const ALLOWED_INPUT_KEYS = ['type', 'filters', 'page', 'sinceRevision'];

const STRING_FILTER_KEYS = [
    'stableId',
    'exactName',
    'fuzzyName',
    'kind',
    'tag',
    'role',
    'parentId',
    'sectionId',
    'deviceType',
    'deviceCategory',
    'routeFromId',
    'routeToId',
    'assetType',
] as const satisfies readonly (keyof SemanticProjectQueryFilters)[];

const BOOLEAN_FILTER_KEYS = [
    'selected',
    'locked',
    'muted',
    'soloed',
    'hasAutomation',
] as const satisfies readonly (keyof SemanticProjectQueryFilters)[];

const NUMBER_FILTER_KEYS = [
    'startBeat',
    'endBeat',
    'minInferredConfidence',
] as const satisfies readonly (keyof SemanticProjectQueryFilters)[];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isQueryType(value: unknown): value is SemanticProjectQueryType {
    return SEMANTIC_PROJECT_QUERY_TYPES.some((type) => type === value);
}

function isStringFilterKey(key: string): key is (typeof STRING_FILTER_KEYS)[number] {
    return STRING_FILTER_KEYS.some((candidate) => candidate === key);
}

function isBooleanFilterKey(key: string): key is (typeof BOOLEAN_FILTER_KEYS)[number] {
    return BOOLEAN_FILTER_KEYS.some((candidate) => candidate === key);
}

function isNumberFilterKey(key: string): key is (typeof NUMBER_FILTER_KEYS)[number] {
    return NUMBER_FILTER_KEYS.some((candidate) => candidate === key);
}

function assignFilter<Key extends keyof SemanticProjectQueryFilters>(
    filters: SemanticProjectQueryFilters,
    key: Key,
    value: SemanticProjectQueryFilters[Key]
): void {
    filters[key] = value;
}

function assignQueryFilter(filters: SemanticProjectQueryFilters, key: string, value: unknown): boolean {
    if (isStringFilterKey(key)) {
        if (!isBoundedString(value, MAX_SEMANTIC_QUERY_FILTER_TEXT_LENGTH)) {
            return false;
        }
        assignFilter(filters, key, value);
        return true;
    }
    if (isBooleanFilterKey(key)) {
        if (typeof value !== 'boolean') {
            return false;
        }
        assignFilter(filters, key, value);
        return true;
    }
    if (isNumberFilterKey(key)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
            return false;
        }
        // The one filter with a stated range: a confidence outside it matches
        // nothing, so it is a malformed request rather than an empty answer.
        if (key === 'minInferredConfidence' && (value < 0 || value > 1)) {
            return false;
        }
        assignFilter(filters, key, value);
        return true;
    }
    if (key === 'contentType' && (value === 'audio' || value === 'midi')) {
        filters.contentType = value;
        return true;
    }
    return false;
}

function parseFilters(value: unknown): SemanticProjectQueryFilters | null {
    if (!isRecord(value)) {
        return null;
    }
    const filters: SemanticProjectQueryFilters = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!assignQueryFilter(filters, key, entry)) {
            return null;
        }
    }
    return filters;
}

function parsePage(value: unknown): QueryPage | null {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'limit' && key !== 'cursor')) {
        return null;
    }
    const page: QueryPage = {};
    if (value.limit !== undefined) {
        if (
            typeof value.limit !== 'number' ||
            !Number.isInteger(value.limit) ||
            value.limit < 1 ||
            value.limit > MAX_SEMANTIC_QUERY_PAGE_SIZE
        ) {
            return null;
        }
        page.limit = value.limit;
    }
    if (value.cursor !== undefined) {
        if (!isBoundedString(value.cursor, MAX_SEMANTIC_QUERY_CURSOR_LENGTH)) {
            return null;
        }
        page.cursor = value.cursor;
    }
    return page;
}

export function parseSemanticProjectQueryInput(value: unknown): ParsedSemanticProjectQueryInput {
    if (!isRecord(value) || Object.keys(value).some((key) => !ALLOWED_INPUT_KEYS.includes(key))) {
        return { status: 'invalid', reason: 'arguments' };
    }
    if (!isQueryType(value.type)) {
        return { status: 'invalid', reason: 'arguments' };
    }
    const input: SemanticProjectQueryInput = { type: value.type };
    if (value.filters !== undefined) {
        const filters = parseFilters(value.filters);
        if (!filters) {
            return { status: 'invalid', reason: 'filters' };
        }
        input.filters = filters;
    }
    if (value.page !== undefined) {
        const page = parsePage(value.page);
        if (!page) {
            return { status: 'invalid', reason: 'page' };
        }
        input.page = page;
    }
    if (value.sinceRevision !== undefined) {
        if (!isBoundedString(value.sinceRevision, MAX_SEMANTIC_QUERY_REVISION_TOKEN_LENGTH)) {
            return { status: 'invalid', reason: 'revision' };
        }
        input.sinceRevision = value.sinceRevision;
    }
    return { status: 'valid', input };
}
