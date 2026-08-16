import { getProjectProtocolContracts } from '#/modules/Project/useCases';

import { type ToolSchema } from '../models/ToolDefinitions';

export const PROJECT_QUERY_TOOL_NAME = 'project.query';
export const PROJECT_RESOLVE_TOOL_NAME = 'project.resolve';
export const AGENT_CAPABILITIES_TOOL_NAME = 'agent.capabilities';
export const AGENT_CATALOG_DISCOVERY_TOOL_NAME = 'agent.catalog.discover';
export const COMMAND_BATCH_PROPOSAL_TOOL_NAME = 'command.batch.propose';
export const COMMAND_HISTORY_TOOL_NAME = 'command.history';
export const RENDER_REQUEST_TOOL_NAME = 'render.request';
export const ANALYSIS_REQUEST_TOOL_NAME = 'analysis.request';

const MAX_DISCOVERED_SCHEMAS = 8;

function tool(
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[] = []
): ToolSchema {
    return {
        type: 'function',
        function: {
            name,
            description,
            parameters: { type: 'object', properties, required, additionalProperties: false },
        },
    };
}

function getProjectQuerySchema(): ToolSchema {
    const queryTypes = getProjectProtocolContracts().query.operations.map((operation) => operation.name);
    return tool(
        PROJECT_QUERY_TOOL_NAME,
        'Read bounded, revision-bearing project facts. Query calls must be returned alone; use their receipts in a later planning turn.',
        {
            type: { type: 'string', enum: queryTypes },
            filters: { type: 'object', additionalProperties: false },
            page: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 50 },
                    cursor: { type: 'string', maxLength: 256 },
                },
                additionalProperties: false,
            },
            sinceRevision: { type: 'string', maxLength: 65_536 },
        },
        ['type']
    );
}

export function getAgentToolCatalogSchemas(): readonly ToolSchema[] {
    return [
        getProjectQuerySchema(),
        tool(
            PROJECT_RESOLVE_TOOL_NAME,
            'Resolve one stable project identity through bounded, revision-bearing application evidence.',
            {
                stableId: { type: 'string', minLength: 1, maxLength: 256 },
            },
            ['stableId']
        ),
        tool(
            AGENT_CAPABILITIES_TOOL_NAME,
            'Read application-owned capability availability and lifecycle authority.',
            {}
        ),
        tool(
            AGENT_CATALOG_DISCOVERY_TOOL_NAME,
            'Discover current high-level tool or command schemas. Command schemas are returned only for explicitly requested operation names.',
            {
                category: {
                    type: 'string',
                    enum: [
                        'query',
                        'resolve',
                        'capability',
                        'catalog',
                        'preview',
                        'command',
                        'commit',
                        'history',
                        'render',
                        'analysis',
                        'approval',
                    ],
                },
                names: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_DISCOVERED_SCHEMAS,
                    items: { type: 'string', maxLength: 128 },
                },
                page: {
                    type: 'object',
                    properties: {
                        limit: { type: 'integer', minimum: 1, maximum: MAX_DISCOVERED_SCHEMAS },
                        cursor: { type: 'string', maxLength: 2048 },
                    },
                    additionalProperties: false,
                },
            },
            ['category', 'names']
        ),
        tool(
            COMMAND_BATCH_PROPOSAL_TOOL_NAME,
            'Propose one ordered command batch. The application validates and grounds each discovered command before preview or approval; this tool cannot commit.',
            {
                commands: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 32,
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string', maxLength: 128 },
                            arguments: { type: 'object' },
                        },
                        required: ['name', 'arguments'],
                        additionalProperties: false,
                    },
                },
                list: {
                    type: 'object',
                    description:
                        'Version 1 bounded semantic command list. Each item names a discovered command and may use one bounded selector, exclusion, condition, quantity, dependency, and local repetition descriptor. The application resolves IDs and guards from one snapshot.',
                    properties: {
                        schemaVersion: { type: 'integer', enum: [1] },
                        items: {
                            type: 'array',
                            minItems: 1,
                            maxItems: 16,
                            items: {
                                type: 'object',
                                properties: {
                                    id: { type: 'string', minLength: 1, maxLength: 128 },
                                    name: { type: 'string', minLength: 1, maxLength: 128 },
                                    arguments: { type: 'object' },
                                    selector: { type: 'object' },
                                    repeat: { type: 'object' },
                                    dependsOn: {
                                        type: 'array',
                                        maxItems: 16,
                                        items: { type: 'string', maxLength: 128 },
                                    },
                                },
                                required: ['id', 'name', 'arguments'],
                                additionalProperties: false,
                            },
                        },
                    },
                    required: ['schemaVersion', 'items'],
                    additionalProperties: false,
                },
                plan: {
                    type: 'object',
                    properties: {
                        semantic: {
                            type: 'object',
                            properties: {
                                classification: { type: 'string', enum: ['simple', 'complex'] },
                                uncertainty: { type: 'array', maxItems: 32, items: { type: 'string' } },
                            },
                            required: ['classification', 'uncertainty'],
                            additionalProperties: false,
                        },
                        objective: { type: 'string', minLength: 1, maxLength: 512 },
                        constraints: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
                        scope: {
                            type: 'object',
                            properties: {
                                targetIds: { type: 'array', maxItems: 128, items: { type: 'string', maxLength: 512 } },
                                targetRanges: { type: 'array', maxItems: 128, items: { type: 'object' } },
                                protectedTargetIds: {
                                    type: 'array',
                                    maxItems: 128,
                                    items: { type: 'string', maxLength: 512 },
                                },
                                protectedRanges: { type: 'array', maxItems: 128, items: { type: 'object' } },
                            },
                            required: ['targetIds', 'targetRanges', 'protectedTargetIds', 'protectedRanges'],
                            additionalProperties: false,
                        },
                        capabilityIds: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
                        assetIds: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
                        alternatives: { type: 'array', maxItems: 32, items: { type: 'object' } },
                        validationStrategy: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
                        stoppingConditions: { type: 'array', maxItems: 32, items: { type: 'string', maxLength: 512 } },
                    },
                    required: [
                        'semantic',
                        'objective',
                        'constraints',
                        'scope',
                        'capabilityIds',
                        'assetIds',
                        'alternatives',
                        'validationStrategy',
                        'stoppingConditions',
                    ],
                    additionalProperties: false,
                },
            },
            []
        ),
        tool(COMMAND_HISTORY_TOOL_NAME, 'Read bounded, revision-bearing command history.', {
            page: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 50 },
                    cursor: { type: 'string', maxLength: 256 },
                },
                additionalProperties: false,
            },
        }),
        tool(
            RENDER_REQUEST_TOOL_NAME,
            'Propose an application-owned section render. The request is validated and remains subject to application approval.',
            {
                sectionIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 32,
                    items: { type: 'string', minLength: 1, maxLength: 256 },
                },
            },
            ['sectionIds']
        ),
        tool(
            ANALYSIS_REQUEST_TOOL_NAME,
            'Propose application-owned mix analysis. The application validates the proposal before execution.',
            {
                scope: { type: 'string', enum: ['mix'] },
            },
            ['scope']
        ),
    ];
}
