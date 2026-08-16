import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import { type ToolSchema } from '../models/ToolDefinitions';

import {
    AGENT_CAPABILITIES_TOOL_NAME,
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    ANALYSIS_REQUEST_TOOL_NAME,
    COMMAND_HISTORY_TOOL_NAME,
    getAgentToolCatalogSchemas,
    PROJECT_QUERY_TOOL_NAME,
    PROJECT_RESOLVE_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
} from './agentToolCatalog';

type CatalogCategory =
    | 'query'
    | 'resolve'
    | 'capability'
    | 'catalog'
    | 'preview'
    | 'command'
    | 'commit'
    | 'history'
    | 'render'
    | 'analysis'
    | 'approval';

type CatalogPage = { cursor?: string; limit?: number };

type LifecycleAvailability = {
    name: 'command.batch.preview' | 'command.batch.commit' | 'command.approval';
    kind: 'application-managed-lifecycle';
    callable: false;
    owner: 'Command';
    availability: 'available';
    authority: string;
};

const MAX_DISCOVERED_SCHEMAS = 8;
const CURSOR_PATTERN = /^(0|[1-9][0-9]{0,15})$/;

const lifecycleAvailability: readonly LifecycleAvailability[] = [
    {
        name: 'command.batch.preview',
        kind: 'application-managed-lifecycle',
        callable: false,
        owner: 'Command',
        availability: 'available',
        authority: 'Created from a validated proposal by Command; not provider-callable.',
    },
    {
        name: 'command.batch.commit',
        kind: 'application-managed-lifecycle',
        callable: false,
        owner: 'Command',
        availability: 'available',
        authority: 'Requires application-issued user approval and revision validation; not provider-callable.',
    },
    {
        name: 'command.approval',
        kind: 'application-managed-lifecycle',
        callable: false,
        owner: 'Command',
        availability: 'available',
        authority: 'User-facing confirmation is application-owned; a model cannot self-approve.',
    },
] as const;

function getCategoryEntries(category: CatalogCategory) {
    if (category === 'command') {
        return getExecutableAppActionToolSchemas();
    }
    if (category === 'preview') {
        return lifecycleAvailability.filter((entry) => entry.name === 'command.batch.preview');
    }
    if (category === 'commit') {
        return lifecycleAvailability.filter((entry) => entry.name === 'command.batch.commit');
    }
    if (category === 'approval') {
        return lifecycleAvailability.filter((entry) => entry.name === 'command.approval');
    }
    const nameByCategory = {
        query: PROJECT_QUERY_TOOL_NAME,
        resolve: PROJECT_RESOLVE_TOOL_NAME,
        capability: AGENT_CAPABILITIES_TOOL_NAME,
        catalog: AGENT_CATALOG_DISCOVERY_TOOL_NAME,
        history: COMMAND_HISTORY_TOOL_NAME,
        render: RENDER_REQUEST_TOOL_NAME,
        analysis: ANALYSIS_REQUEST_TOOL_NAME,
    } as const;
    const name = nameByCategory[category];
    return getAgentToolCatalogSchemas().filter((schema) => schema.function.name === name);
}

function requireExactNames(names: readonly string[]): void {
    if (
        names.length === 0 ||
        names.length > MAX_DISCOVERED_SCHEMAS ||
        names.some((name) => name.length === 0 || name.length > 128) ||
        new Set(names).size !== names.length
    ) {
        throw new Error('Catalog names do not match the strict catalog contract.');
    }
}

function getPageOffset(cursor: string | undefined, total: number): number {
    if (cursor === undefined) {
        return 0;
    }
    if (!CURSOR_PATTERN.test(cursor)) {
        throw new Error('Catalog cursor does not match the strict catalog contract.');
    }
    const offset = Number(cursor);
    if (!Number.isSafeInteger(offset) || offset > total) {
        throw new Error('Catalog cursor is outside the requested catalog page.');
    }
    return offset;
}

function requirePageLimit(limit: number | undefined): number {
    if (limit === undefined) {
        return MAX_DISCOVERED_SCHEMAS;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DISCOVERED_SCHEMAS) {
        throw new Error('Catalog page limit does not match the strict catalog contract.');
    }
    return limit;
}

function getCatalogEntryName(entry: ToolSchema | LifecycleAvailability): string {
    return 'function' in entry ? entry.function.name : entry.name;
}

export function getAgentToolCatalogEntries(input: {
    category: CatalogCategory;
    names: readonly string[];
    page?: CatalogPage;
}) {
    requireExactNames(input.names);
    const entries = getCategoryEntries(input.category);
    const entriesByName = new Map(entries.map((entry) => [getCatalogEntryName(entry), entry]));
    const requested = input.names.map((name) => {
        const entry = entriesByName.get(name);
        if (!entry) {
            throw new Error(`Catalog entry is unavailable: ${name}`);
        }
        return entry;
    });
    const offset = getPageOffset(input.page?.cursor, requested.length);
    const limit = requirePageLimit(input.page?.limit);
    const items = requested.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
        schema: 'sourdaw.agent-tool-catalog',
        schemaVersion: 1 as const,
        category: input.category,
        items: structuredClone(items),
        nextCursor: nextOffset < requested.length ? String(nextOffset) : null,
        page: { limit, offset, total: requested.length },
        truncated: nextOffset < requested.length,
    };
}
