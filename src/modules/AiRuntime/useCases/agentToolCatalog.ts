import { getMixRecipeCatalog } from '#/modules/Arrangement/useCases';
import { getAgentMeasurementMetricIds } from '#/modules/AudioAnalysis/useCases';
import { getDeclarativeTransformDocumentSchema } from '#/modules/Command/useCases';
import { getProjectProtocolContracts } from '#/modules/Project/useCases';
import { MIDI_TRANSFORM_MAX_NOTES } from '#/utils/midiNoteBatchLimits';

import {
    AGENT_CAPABILITIES_TOOL_NAME,
    AGENT_CATALOG_CATEGORIES,
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    ANALYSIS_REQUEST_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    COMMAND_HISTORY_TOOL_NAME,
    MAX_DISCOVERED_COMMAND_SCHEMAS,
    PROJECT_DISCOVERY_TOOL_NAME,
    PROJECT_QUERY_TOOL_NAME,
    PROJECT_RESOLVE_TOOL_NAME,
    RECIPE_DISCOVERY_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
} from '../models/AgentToolCatalogNames';
import { ANALYSIS_MEASURE_MAX_ID_LENGTH, ANALYSIS_MEASURE_MAX_TARGETS } from '../models/AnalysisMeasureLimits';
import {
    COMMAND_BATCH_DECLINE_KINDS,
    COMMAND_BATCH_DECLINE_MAX_QUESTION_LENGTH,
    COMMAND_BATCH_DECLINE_MAX_QUESTIONS,
    COMMAND_BATCH_DECLINE_MAX_REASON_LENGTH,
} from '../models/CommandBatchDecline';
import { DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT } from '../models/DeviceManifestPageLimits';
import { MAX_LLM_ACTIONS_PER_BATCH } from '../models/LlmActionLimits';
import {
    RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH,
    RECIPE_EXPANSION_MAX_STEP_INDEX,
    RECIPE_EXPANSION_MAX_TARGET_ID_LENGTH,
    RECIPE_EXPANSION_MAX_VALUES,
} from '../models/RecipeExpansionLimits';
import { SEMANTIC_COMMAND_LIST_V1_JSON_SCHEMA } from '../models/SemanticCommandList';
import { type ToolSchema } from '../models/ToolDefinitions';

export {
    AGENT_CAPABILITIES_TOOL_NAME,
    AGENT_CATALOG_DISCOVERY_TOOL_NAME,
    AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    ANALYSIS_REQUEST_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    COMMAND_HISTORY_TOOL_NAME,
    MANDATORY_PLANNING_TOOL_NAMES,
    PROJECT_DISCOVERY_TOOL_NAME,
    PROJECT_QUERY_TOOL_NAME,
    PROJECT_RESOLVE_TOOL_NAME,
    RECIPE_DISCOVERY_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
    RENDER_REQUEST_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
} from '../models/AgentToolCatalogNames';

export const AGENT_CATALOG_CURSOR_MAX_LENGTH = 2048;
export const AGENT_CATALOG_CURSOR_PATTERN = '^[A-Za-z0-9_-]+$';
export const AGENT_CATALOG_CURSOR_JSON_SCHEMA = {
    type: 'string',
    minLength: 1,
    maxLength: AGENT_CATALOG_CURSOR_MAX_LENGTH,
    pattern: AGENT_CATALOG_CURSOR_PATTERN,
} as const;

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

function getProjectDiscoverySchema(): ToolSchema {
    const domains = getProjectProtocolContracts().discovery.operations.map((operation) => operation.name);
    return tool(
        PROJECT_DISCOVERY_TOOL_NAME,
        'Discover the devices, presets, samples, assets and capabilities their owners publish, as one bounded revision-bearing page.',
        {
            domain: { type: 'string', enum: domains },
            filters: {
                type: 'object',
                properties: {
                    text: { type: 'string', minLength: 1, maxLength: 256 },
                    stableId: { type: 'string', minLength: 1, maxLength: 256 },
                    kind: { type: 'string', minLength: 1, maxLength: 256 },
                },
                additionalProperties: false,
            },
            page: {
                type: 'object',
                properties: {
                    limit: { type: 'integer', minimum: 1, maximum: 50 },
                    cursor: { type: 'string', maxLength: 256 },
                },
                additionalProperties: false,
            },
        },
        ['domain']
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
            category: { type: 'string', enum: AGENT_CATALOG_CATEGORIES },
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

function getRecipeDiscoverySchema(): ToolSchema {
    const roles = getMixRecipeCatalog().roles;
    return tool(
        RECIPE_DISCOVERY_TOOL_NAME,
        "Find mixing recipes for perceptual descriptors (for example warm, brighter, less muddy). Name the target track or bus to filter by its role and existing device chain, or pass role directly; results carry parameter ranges and metric expectations, and final values are chosen inside each range. A candidate with an origin is a factory chain preset: its descriptor and roles are the preset author's tags, and each range is the single value the preset stores.",
        {
            descriptors: {
                type: 'array',
                minItems: 1,
                maxItems: 4,
                items: { type: 'string', minLength: 1, maxLength: 48 },
            },
            targetId: { type: 'string', minLength: 1, maxLength: 256 },
            role: { type: 'string', enum: [...roles] },
            limit: { type: 'integer', minimum: 1, maximum: 8 },
        },
        ['descriptors']
    );
}

function getRecipeExpansionSchema(): ToolSchema {
    const roles = getMixRecipeCatalog().roles;
    return tool(
        RECIPE_EXPANSION_TOOL_NAME,
        "Expand one recipe found by recipe.discover against one track into the ordinary device commands the application builds for you: an addDevice for each insert step and a setDeviceParameter for each authored parameter, in the recipe's order. This is a preview: it does not mutate the project. Use the returned callId in command.batch.propose compiledCallIds to adopt its exact commands; the application grounds and validates them like any command you write. Each parameter takes the middle of its range unless values names it, and a supplied value must lie inside that parameter's range.",
        {
            recipeId: { type: 'string', minLength: 1, maxLength: RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH },
            targetId: { type: 'string', minLength: 1, maxLength: RECIPE_EXPANSION_MAX_TARGET_ID_LENGTH },
            role: { type: 'string', enum: [...roles] },
            values: {
                type: 'array',
                maxItems: RECIPE_EXPANSION_MAX_VALUES,
                items: {
                    type: 'object',
                    properties: {
                        step: {
                            type: 'integer',
                            minimum: 0,
                            maximum: RECIPE_EXPANSION_MAX_STEP_INDEX,
                            description: "Zero-based position of the step in the recipe's steps list.",
                        },
                        paramId: { type: 'string', minLength: 1, maxLength: RECIPE_EXPANSION_MAX_IDENTIFIER_LENGTH },
                        value: { type: 'number', description: "Value in the parameter's native unit." },
                    },
                    required: ['step', 'paramId', 'value'],
                    additionalProperties: false,
                },
            },
        },
        ['recipeId', 'targetId']
    );
}

/** The scope, range and metrics a project measurement reads, which `analysis.measure` and `analysis.compareReference` share. */
function getProjectMeasurementProperties() {
    const metricIds = getAgentMeasurementMetricIds();
    const boundedId = { type: 'string', minLength: 1, maxLength: ANALYSIS_MEASURE_MAX_ID_LENGTH };
    return {
        scope: {
            type: 'object',
            properties: {
                kind: { type: 'string', enum: ['master', 'project', 'tracks', 'buses'] },
                ids: {
                    type: 'array',
                    minItems: 1,
                    maxItems: ANALYSIS_MEASURE_MAX_TARGETS,
                    items: { ...boundedId },
                },
            },
            required: ['kind'],
            additionalProperties: false,
        },
        range: {
            type: 'object',
            properties: {
                sectionId: { ...boundedId },
                startBeat: { type: 'number', minimum: 0 },
                endBeat: { type: 'number', minimum: 0 },
            },
            additionalProperties: false,
        },
        metrics: {
            type: 'array',
            minItems: 1,
            maxItems: metricIds.length,
            items: { type: 'string', enum: [...metricIds] },
        },
    };
}

function getAnalysisMeasureSchema(): ToolSchema {
    return tool(
        ANALYSIS_MEASURE_TOOL_NAME,
        `Measure objective figures of the rendered audio of one scope over a section or beat range: the master mix (kind "master" or "project", with mute and solo applied), or up to ${String(ANALYSIS_MEASURE_MAX_TARGETS)} tracks or buses, each rendered in isolation with its inserts and send returns and without solo. The application renders at the current project revision and returns loudness, peak, dynamics, spectral, stereo and transient figures, never audio. Name the range by sectionId or by startBeat and endBeat. With subject "preview", also pass proposal, a semantic command list in the form command.batch.propose takes as list: the application compiles it, previews it without changing the project, and measures the same scope and range before and after it, returning both figures and their deltas. To propose exactly the measured change, pass this call's callId in command.batch.propose compiledCallIds.`,
        {
            subject: { type: 'string', enum: ['project', 'preview'] },
            proposal: SEMANTIC_COMMAND_LIST_V1_JSON_SCHEMA,
            ...getProjectMeasurementProperties(),
        },
        ['scope', 'range']
    );
}

function getAnalysisCompareReferenceSchema(): ToolSchema {
    return tool(
        ANALYSIS_COMPARE_REFERENCE_TOOL_NAME,
        `Compare the project to the reference the user loaded for comparison. Takes the scope and range analysis.measure takes. The application measured the reference locally over its whole duration, renders the project scope at the current project revision, and returns the reference's figures, the project's figures for each target, and per-metric deltas that read reference minus project: a positive loudness delta means the reference is louder than the project. A per-band figure has no delta. Only figures are returned, never the reference file or any audio; the reference is named by an opaque identifier. Fails with no-reference-loaded while the user has loaded none. Counts against the one measurement allowed per turn, alongside analysis.measure.`,
        getProjectMeasurementProperties(),
        ['scope', 'range']
    );
}

export function getAgentToolCatalogSchemas(): readonly ToolSchema[] {
    return [
        getProjectQuerySchema(),
        getProjectDiscoverySchema(),
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
            TRANSFORM_COMPILE_TOOL_NAME,
            'Compile a bounded declarative edit against the captured project snapshot. This is a preview: it does not mutate the project. Use the returned callId in command.batch.propose compiledCallIds to select its exact expanded commands.',
            { document: getDeclarativeTransformDocumentSchema() },
            ['document']
        ),
        tool(
            AGENT_DEVICE_MANIFEST_TOOL_NAME,
            `Read the bounded versioned factory manifest for built-in and scanned external devices. This is application-grounded read evidence, not plugin-state authority. Call with no arguments to list every available device type as { id, name }; a later turn's context omits that list. A large descriptor's full receipt can exceed the per-call budget and come back as tool-receipt-too-large; when that happens, request that one type alone. page: { index: true } returns the type's compact parameter index — { id, name } for every parameter — in one receipt; then read only the parameters the request needs in one call with parameterIds (up to ${String(
                DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT
            )} ids of that type), which returns their full bounds, legal value sets and guidance. To read contiguous parameter windows instead, use page: { cursor, limit } (limit up to ${String(
                DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT
            )}) and follow nextCursor until it is null.`,
            {
                types: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 8,
                    items: { type: 'string', minLength: 1, maxLength: 256 },
                },
                parameterIds: {
                    type: 'array',
                    minItems: 1,
                    maxItems: DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT,
                    uniqueItems: true,
                    items: { type: 'string', minLength: 1, maxLength: 256 },
                },
                page: {
                    type: 'object',
                    properties: {
                        limit: { type: 'integer', minimum: 1, maximum: DEVICE_MANIFEST_PARAMETER_PAGE_LIMIT },
                        cursor: { ...AGENT_CATALOG_CURSOR_JSON_SCHEMA },
                        index: { type: 'boolean', enum: [true] },
                    },
                    additionalProperties: false,
                },
            }
        ),
        tool(
            COMMAND_BATCH_PROPOSAL_TOOL_NAME,
            `Propose one ordered command batch. The application validates and grounds each discovered command before preview or approval; this tool cannot commit. A discovered MIDI transform is a list item like any other: it names a clip and a seed, and the application expands it into the addNotes commands that carry its notes, up to ${String(MIDI_TRANSFORM_MAX_NOTES)} notes in total.`,
            {
                commands: {
                    type: 'array',
                    minItems: 0,
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
                compiledCallIds: {
                    type: 'array',
                    maxItems: MAX_LLM_ACTIONS_PER_BATCH,
                    uniqueItems: true,
                    items: { type: 'string', minLength: 1, maxLength: 256 },
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
        getAnalysisMeasureSchema(),
        getAnalysisCompareReferenceSchema(),
        getRecipeDiscoverySchema(),
        getRecipeExpansionSchema(),
    ];
}
