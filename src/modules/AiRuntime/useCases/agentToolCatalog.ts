import { getProjectProtocolContracts } from '#/modules/Project/useCases';
import { MIDI_TRANSFORM_MAX_NOTES } from '#/utils/midiNoteBatchLimits';

import {
    AGENT_CAPABILITIES_TOOL_NAME,
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    ANALYSIS_REQUEST_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    COMMAND_HISTORY_TOOL_NAME,
    MAX_DISCOVERED_COMMAND_SCHEMAS,
    PROJECT_QUERY_TOOL_NAME,
    PROJECT_RESOLVE_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
} from '../models/AgentToolCatalogNames';
import {
    COMMAND_BATCH_DECLINE_KINDS,
    COMMAND_BATCH_DECLINE_MAX_QUESTION_LENGTH,
    COMMAND_BATCH_DECLINE_MAX_QUESTIONS,
    COMMAND_BATCH_DECLINE_MAX_REASON_LENGTH,
} from '../models/CommandBatchDecline';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import { SEMANTIC_COMMAND_LIST_V1_JSON_SCHEMA } from '../models/SemanticCommandList';
import { type ToolSchema } from '../models/ToolDefinitions';

export {
    AGENT_CAPABILITIES_TOOL_NAME,
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    ANALYSIS_REQUEST_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    COMMAND_HISTORY_TOOL_NAME,
    PROJECT_QUERY_TOOL_NAME,
    PROJECT_RESOLVE_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
} from '../models/AgentToolCatalogNames';

export const AGENT_CATALOG_CURSOR_MAX_LENGTH = 2048;
export const AGENT_CATALOG_CURSOR_PATTERN = '^[A-Za-z0-9_-]+$';
export const AGENT_CATALOG_CURSOR_JSON_SCHEMA = {
    type: 'string',
    minLength: 1,
    maxLength: AGENT_CATALOG_CURSOR_MAX_LENGTH,
    pattern: AGENT_CATALOG_CURSOR_PATTERN,
} as const;

const EXACT_CATALOG_CATEGORIES = [
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
] as const;

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

function getCatalogDiscoverySchema(): ToolSchema {
    const page = {
        type: 'object',
        properties: {
            limit: { type: 'integer', minimum: 1, maximum: MAX_DISCOVERED_COMMAND_SCHEMAS },
            cursor: { ...AGENT_CATALOG_CURSOR_JSON_SCHEMA },
        },
        additionalProperties: false,
    };
    return tool(
        AGENT_CATALOG_DISCOVERY_TOOL_NAME,
        'Request exact schemas by canonical catalog names. Primitive schemas are returned only for explicitly requested operation names.',
        {
            category: { type: 'string', enum: EXACT_CATALOG_CATEGORIES },
            names: {
                type: 'array',
                minItems: 1,
                maxItems: MAX_DISCOVERED_COMMAND_SCHEMAS,
                items: { type: 'string', minLength: 1, maxLength: 128 },
            },
            page,
        },
        ['category', 'names']
    );
}

function getCommandIndexSearchSchema(): ToolSchema {
    return tool(
        AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
        'Search the compact command index by high-level intent before requesting exact command schemas by canonical names.',
        {
            intent: { type: 'string', minLength: 1, maxLength: 512 },
            page: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: MAX_DISCOVERED_COMMAND_SCHEMAS },
                    cursor: { ...AGENT_CATALOG_CURSOR_JSON_SCHEMA },
                },
                additionalProperties: false,
            },
        },
        ['intent']
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
        getCatalogDiscoverySchema(),
        getCommandIndexSearchSchema(),
        tool(
            AGENT_DEVICE_MANIFEST_TOOL_NAME,
            'Read the bounded versioned factory manifest for built-in and scanned external devices. This is application-grounded read evidence, not plugin-state authority.',
            {
                types: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    items: { type: 'string', minLength: 1, maxLength: 256 },
                },
            },
            ['types']
        ),
        tool(
            COMMAND_BATCH_PROPOSAL_TOOL_NAME,
            `Propose one ordered command batch. The application validates and grounds each discovered command before preview or approval; this tool cannot commit. A discovered MIDI transform is a list item like any other: it names a clip and a seed, and the application expands it into the addNotes commands that carry its notes, up to ${String(MIDI_TRANSFORM_MAX_NOTES)} notes in total.`,
            {
                commands: {
                    type: 'array',
                    minItems: 1,
                    maxItems: MAX_LLM_ACTIONS_PER_BATCH,
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
                list: SEMANTIC_COMMAND_LIST_V1_JSON_SCHEMA,
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
        tool(
            COMMAND_BATCH_DECLINE_TOOL_NAME,
            `Decline to propose a batch, and say why. Use kind "clarify" only when the request is ambiguous about authority, target, or scope and that ambiguity cannot be resolved from project evidence; supply the concrete questions that would resolve it. Use kind "unsupported" only after ${AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME} found no command for the required capability. Return this call alone in its turn.`,
            {
                kind: { type: 'string', enum: [...COMMAND_BATCH_DECLINE_KINDS] },
                reason: { type: 'string', minLength: 1, maxLength: COMMAND_BATCH_DECLINE_MAX_REASON_LENGTH },
                questions: {
                    type: 'array',
                    maxItems: COMMAND_BATCH_DECLINE_MAX_QUESTIONS,
                    items: { type: 'string', minLength: 1, maxLength: COMMAND_BATCH_DECLINE_MAX_QUESTION_LENGTH },
                },
            },
            ['kind', 'reason', 'questions']
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
