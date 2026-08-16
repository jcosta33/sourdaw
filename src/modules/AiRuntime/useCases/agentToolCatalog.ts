import { getProjectProtocolContracts } from '#/modules/Project/useCases';

import { type ToolSchema } from '../models/ToolDefinitions';

export const PROJECT_QUERY_TOOL_NAME = 'project.query';
export const AGENT_CATALOG_DISCOVERY_TOOL_NAME = 'agent.catalog.discover';
export const COMMAND_BATCH_PROPOSAL_TOOL_NAME = 'command.batch.propose';

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
            'project.resolve',
            'Resolve an exact project reference through bounded application-owned project evidence.',
            {
                reference: { type: 'string', maxLength: 256 },
            },
            ['reference']
        ),
        tool('agent.capabilities', 'Read application-owned capability availability and versions.', {}),
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
                        cursor: { type: 'string', maxLength: 16 },
                    },
                    additionalProperties: false,
                },
            },
            ['category']
        ),
        tool(
            'command.batch.preview',
            'Request an application-owned preview for a validated command batch; this tool never commits.',
            {
                batch: { type: 'object' },
            },
            ['batch']
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
            },
            ['commands']
        ),
        tool(
            'command.batch.commit',
            'Request commit of an already approved batch. Application-owned approval and revision checks remain mandatory.',
            {
                approvalId: { type: 'string', maxLength: 256 },
            },
            ['approvalId']
        ),
        tool('command.history', 'Read bounded revision-bearing command and receipt history.', {
            page: { type: 'object' },
        }),
        tool(
            'render.request',
            'Request an application-owned revision-bound render job; render receipts remain bounded and correlated.',
            {
                request: { type: 'object' },
            },
            ['request']
        ),
        tool(
            'analysis.request',
            'Request application-owned deterministic analysis over an identified project state or render receipt.',
            {
                request: { type: 'object' },
            },
            ['request']
        ),
        tool(
            'command.approval',
            'Read or request the user-facing approval state for an exact preview. A model cannot self-approve.',
            {
                previewId: { type: 'string', maxLength: 256 },
            },
            ['previewId']
        ),
    ];
}
