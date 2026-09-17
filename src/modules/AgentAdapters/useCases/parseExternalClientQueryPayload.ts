/**
 * The strict argument contract for one external `project.query` payload.
 *
 * An external payload is untrusted input, so the adapter states the vocabulary
 * it forwards rather than handing an arbitrary object to the owner: an
 * unrecognised key is refused, not dropped silently, and every value is bounded
 * before it crosses the boundary. Refusing is deliberately the fail-closed
 * direction — a filter name the owner adds later is simply not reachable from
 * an external client until this contract admits it.
 *
 * The query types themselves are read from the owner's published contract
 * instead of restated, because that list is what the owner actually answers.
 */

import { getProjectProtocolContracts, type querySemanticProject } from '#/modules/Project/useCases';

type QueryInput = Parameters<typeof querySemanticProject>[0];
type QueryFilters = NonNullable<QueryInput['filters']>;
type QueryPage = NonNullable<QueryInput['page']>;

const MAX_FILTER_STRING_LENGTH = 256;
const MAX_CURSOR_LENGTH = 256;
const MAX_REVISION_LENGTH = 65_536;
const MAX_PAGE_LIMIT = 50;

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
] as const;

const BOOLEAN_FILTER_KEYS = ['selected', 'locked', 'muted', 'soloed', 'hasAutomation'] as const;

const NUMBER_FILTER_KEYS = ['startBeat', 'endBeat', 'minInferredConfidence'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isQueryType(value: unknown): value is QueryInput['type'] {
    return (
        typeof value === 'string' &&
        getProjectProtocolContracts().query.operations.some((operation) => operation.name === value)
    );
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

function assignFilter<Key extends keyof QueryFilters>(filters: QueryFilters, key: Key, value: QueryFilters[Key]): void {
    filters[key] = value;
}

function assignQueryFilter(filters: QueryFilters, key: string, value: unknown): boolean {
    if (isStringFilterKey(key)) {
        if (!isBoundedString(value, MAX_FILTER_STRING_LENGTH)) {
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

function parseFilters(value: unknown): QueryFilters | null {
    if (!isRecord(value)) {
        return null;
    }
    const filters: QueryFilters = {};
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
        if (typeof value.limit !== 'number' || !Number.isInteger(value.limit) || value.limit < 1) {
            return null;
        }
        if (value.limit > MAX_PAGE_LIMIT) {
            return null;
        }
        page.limit = value.limit;
    }
    if (value.cursor !== undefined) {
        if (!isBoundedString(value.cursor, MAX_CURSOR_LENGTH)) {
            return null;
        }
        page.cursor = value.cursor;
    }
    return page;
}

type ParsedQueryPayload = { status: 'valid'; input: QueryInput } | { status: 'invalid' };

export function parseExternalClientQueryPayload(payload: unknown): ParsedQueryPayload {
    const allowedKeys = ['type', 'filters', 'page', 'sinceRevision'];
    if (!isRecord(payload) || Object.keys(payload).some((key) => !allowedKeys.includes(key))) {
        return { status: 'invalid' };
    }
    if (!isQueryType(payload.type)) {
        return { status: 'invalid' };
    }
    const input: QueryInput = { type: payload.type };
    if (payload.filters !== undefined) {
        const filters = parseFilters(payload.filters);
        if (!filters) {
            return { status: 'invalid' };
        }
        input.filters = filters;
    }
    if (payload.page !== undefined) {
        const page = parsePage(payload.page);
        if (!page) {
            return { status: 'invalid' };
        }
        input.page = page;
    }
    if (payload.sinceRevision !== undefined) {
        if (!isBoundedString(payload.sinceRevision, MAX_REVISION_LENGTH)) {
            return { status: 'invalid' };
        }
        input.sinceRevision = payload.sinceRevision;
    }
    return { status: 'valid', input };
}
