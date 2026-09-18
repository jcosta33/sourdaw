/**
 * The strict argument contract for one agent discovery request.
 *
 * Bounded the same way the query contract is, and owned here for the same
 * reason: every caller that carries a request in from outside the application
 * parses it through this one function, so there is one statement of which keys
 * exist and how large a value may be.
 *
 * The domain is bounded but not checked against the published list. A domain
 * nobody publishes is a well-formed request that the owner answers as
 * `unsupported`, which is a different fact from arguments the contract cannot
 * read at all — and the caller needs to be able to tell those apart.
 */

import {
    MAX_AGENT_DISCOVERY_CURSOR_LENGTH,
    MAX_AGENT_DISCOVERY_FILTER_TEXT_LENGTH,
    MAX_AGENT_DISCOVERY_PAGE_SIZE,
    type AgentDiscoveryFilters,
    type AgentDiscoveryInput,
} from '../models/AgentDiscoveryQuery';

/** Which part of the input failed, so a caller can say so in its own words. */
type AgentDiscoveryParseFailure = 'arguments' | 'filters' | 'page';

type ParsedAgentDiscoveryInput =
    { status: 'valid'; input: AgentDiscoveryInput } | { status: 'invalid'; reason: AgentDiscoveryParseFailure };

type DiscoveryPage = NonNullable<AgentDiscoveryInput['page']>;

const ALLOWED_INPUT_KEYS = ['domain', 'filters', 'page'];
const FILTER_KEYS = ['text', 'stableId', 'kind'] as const satisfies readonly (keyof AgentDiscoveryFilters)[];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isFilterKey(key: string): key is (typeof FILTER_KEYS)[number] {
    return FILTER_KEYS.some((candidate) => candidate === key);
}

function parseFilters(value: unknown): AgentDiscoveryFilters | null {
    if (!isRecord(value)) {
        return null;
    }
    const filters: AgentDiscoveryFilters = {};
    for (const [key, entry] of Object.entries(value)) {
        if (!isFilterKey(key) || !isBoundedString(entry, MAX_AGENT_DISCOVERY_FILTER_TEXT_LENGTH)) {
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
        if (
            typeof value.limit !== 'number' ||
            !Number.isInteger(value.limit) ||
            value.limit < 1 ||
            value.limit > MAX_AGENT_DISCOVERY_PAGE_SIZE
        ) {
            return null;
        }
        page.limit = value.limit;
    }
    if (value.cursor !== undefined) {
        if (!isBoundedString(value.cursor, MAX_AGENT_DISCOVERY_CURSOR_LENGTH)) {
            return null;
        }
        page.cursor = value.cursor;
    }
    return page;
}

export function parseAgentDiscoveryInput(value: unknown): ParsedAgentDiscoveryInput {
    if (
        !isRecord(value) ||
        Object.keys(value).some((key) => !ALLOWED_INPUT_KEYS.includes(key)) ||
        !isBoundedString(value.domain, MAX_AGENT_DISCOVERY_FILTER_TEXT_LENGTH)
    ) {
        return { status: 'invalid', reason: 'arguments' };
    }
    const input: AgentDiscoveryInput = { domain: value.domain };
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
    return { status: 'valid', input };
}
