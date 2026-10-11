/**
 * Canonical names of the application-owned meta-tools, and the cap on one discovery page. They are
 * a contract rather than a use case, so the system prompt that instructs a provider to call them
 * reads the same constants the loop uses to admit those calls, and a rename cannot leave the two
 * disagreeing.
 */
export const PROJECT_QUERY_TOOL_NAME = 'project.query';
export const PROJECT_DISCOVERY_TOOL_NAME = 'project.discover';
export const PROJECT_RESOLVE_TOOL_NAME = 'project.resolve';
export const AGENT_CAPABILITIES_TOOL_NAME = 'agent.capabilities';
export const AGENT_CATALOG_DISCOVERY_TOOL_NAME = 'agent.catalog.discover';
export const AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME = 'agent.command-index.search';
export const AGENT_DEVICE_MANIFEST_TOOL_NAME = 'device.factory-manifest.read';
export const COMMAND_BATCH_PROPOSAL_TOOL_NAME = 'command.batch.propose';
export const COMMAND_BATCH_DECLINE_TOOL_NAME = 'command.batch.decline';
export const ANSWER_RESPOND_TOOL_NAME = 'answer.respond';
export const COMMAND_HISTORY_TOOL_NAME = 'command.history';
export const RENDER_REQUEST_TOOL_NAME = 'render.request';
export const ANALYSIS_REQUEST_TOOL_NAME = 'analysis.request';
export const ANALYSIS_MEASURE_TOOL_NAME = 'analysis.measure';
export const ANALYSIS_COMPARE_REFERENCE_TOOL_NAME = 'analysis.compareReference';
export const RECIPE_DISCOVERY_TOOL_NAME = 'recipe.discover';
export const RECIPE_EXPANSION_TOOL_NAME = 'recipe.expand';
export const TRANSFORM_COMPILE_TOOL_NAME = 'transform.compile';

/**
 * The planning tools every backend advertises on every request. A backend that narrows its tool
 * list (WebLLM, under its prompt budget) may drop any other tool but never one of these, so the
 * planner can always read the project, measure, discover and expand recipes, read the device
 * manifest, compile a transform, and end the run by proposing, declining, or answering.
 */
export const MANDATORY_PLANNING_TOOL_NAMES = [
    PROJECT_QUERY_TOOL_NAME,
    ANALYSIS_MEASURE_TOOL_NAME,
    RECIPE_DISCOVERY_TOOL_NAME,
    RECIPE_EXPANSION_TOOL_NAME,
    AGENT_DEVICE_MANIFEST_TOOL_NAME,
    TRANSFORM_COMPILE_TOOL_NAME,
    COMMAND_BATCH_PROPOSAL_TOOL_NAME,
    COMMAND_BATCH_DECLINE_TOOL_NAME,
    ANSWER_RESPOND_TOOL_NAME,
] as const;

export const MAX_DISCOVERED_COMMAND_SCHEMAS = 8;

/**
 * The categories `agent.catalog.discover` admits. The published schema enum, the loop's argument
 * check and the catalog's entry lookup all read this one list, so a category cannot be offered to a
 * provider that the lookup does not serve, or served without being offered. `command-index` is
 * searched through its own tool and is not one of them.
 */
export const AGENT_CATALOG_CATEGORIES = [
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

export type AgentCatalogCategory = (typeof AGENT_CATALOG_CATEGORIES)[number];
