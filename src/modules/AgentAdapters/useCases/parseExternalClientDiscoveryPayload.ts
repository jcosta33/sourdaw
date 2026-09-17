/**
 * The strict argument contract for one external `project.discover` payload.
 *
 * Bounded the same way the query contract is, and for the same reason. The
 * domain itself is not checked against a list here: a domain nobody publishes
 * is still a well-formed request, and the owner answers it as unsupported —
 * which is a different fact from arguments the contract cannot read at all.
 */

import type { queryAgentDiscovery } from '#/modules/Project/useCases';

type DiscoveryInput = Parameters<typeof queryAgentDiscovery>[0];
type DiscoveryFilters = NonNullable<DiscoveryInput['filters']>;
type DiscoveryPage = NonNullable<DiscoveryInput['page']>;

const MAX_FILTER_STRING_LENGTH = 256;
const MAX_CURSOR_LENGTH = 256;
const MAX_PAGE_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function parseFilters(value: unknown): DiscoveryFilters | null {
    if (!isRecord(value)) {
        return null;
    }
    const filters: DiscoveryFilters = {};
    for (const [key, entry] of Object.entries(value)) {
        if (
            (key !== 'text' && key !== 'stableId' && key !== 'kind') ||
            !isBoundedString(entry, MAX_FILTER_STRING_LENGTH)
        ) {
            return null;
        }
        filters[key] = entry;
    }
    return filters;
}

function parsePage(value: unknown): DiscoveryPage | null {
    if (!isRecord(value) || Object.keys(value).some((key) => key !== 'limit' && key !== 'cursor')) {
        return null;
    }
    const page: DiscoveryPage = {};
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

type ParsedDiscoveryPayload = { status: 'valid'; input: DiscoveryInput } | { status: 'invalid' };

export function parseExternalClientDiscoveryPayload(payload: unknown): ParsedDiscoveryPayload {
    const allowedKeys = ['domain', 'filters', 'page'];
    if (
        !isRecord(payload) ||
        Object.keys(payload).some((key) => !allowedKeys.includes(key)) ||
        !isBoundedString(payload.domain, MAX_FILTER_STRING_LENGTH)
    ) {
        return { status: 'invalid' };
    }
    const input: DiscoveryInput = { domain: payload.domain };
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
    return { status: 'valid', input };
}
