import { getExecutableAppActionToolSchemas } from '#/modules/Command/useCases';

import {
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    getAgentToolCatalogSchemas,
    PROJECT_QUERY_TOOL_NAME,
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

function getCatalogPageOffset(cursor: string | undefined): number {
    if (cursor === undefined) {
        return 0;
    }
    const offset = Number(cursor);
    return Number.isInteger(offset) && offset >= 0 ? offset : 0;
}

export function getAgentToolCatalogEntries(input: {
    category: CatalogCategory;
    names?: readonly string[];
    page?: CatalogPage;
}) {
    const schemas =
        input.category === 'command'
            ? getExecutableAppActionToolSchemas()
            : getAgentToolCatalogSchemas().filter((schema) => {
                  const name = schema.function.name;
                  return (
                      (input.category === 'query' && name === PROJECT_QUERY_TOOL_NAME) ||
                      (input.category === 'resolve' && name === 'project.resolve') ||
                      (input.category === 'capability' && name === 'agent.capabilities') ||
                      (input.category === 'catalog' && name === AGENT_CATALOG_DISCOVERY_TOOL_NAME) ||
                      (input.category === 'preview' && name === 'command.batch.preview') ||
                      (input.category === 'commit' && name === 'command.batch.commit') ||
                      (input.category === 'history' && name === 'command.history') ||
                      (input.category === 'render' && name === 'render.request') ||
                      (input.category === 'analysis' && name === 'analysis.request') ||
                      (input.category === 'approval' && name === 'command.approval')
                  );
              });
    const requested =
        input.names === undefined ? schemas : schemas.filter((schema) => input.names?.includes(schema.function.name));
    const offset = getCatalogPageOffset(input.page?.cursor);
    const limit = input.page?.limit ?? 8;
    const items = requested.slice(offset, offset + limit);
    const nextOffset = offset + items.length;
    return {
        schema: 'sourdaw.agent-tool-catalog',
        schemaVersion: 1 as const,
        category: input.category,
        items: items.map((schema) => structuredClone(schema)),
        nextCursor: nextOffset < requested.length ? String(nextOffset) : null,
        page: { limit, offset, total: requested.length },
        truncated: nextOffset < requested.length,
    };
}
