/**
 * Canonical names of the application-owned meta-tools, and the cap on one discovery page. They are
 * a contract rather than a use case, so the system prompt that instructs a provider to call them
 * reads the same constants the loop uses to admit those calls, and a rename cannot leave the two
 * disagreeing.
 */
export const PROJECT_QUERY_TOOL_NAME = 'project.query';
export const PROJECT_RESOLVE_TOOL_NAME = 'project.resolve';
export const AGENT_CAPABILITIES_TOOL_NAME = 'agent.capabilities';
export const AGENT_CATALOG_DISCOVERY_TOOL_NAME = 'agent.catalog.discover';
export const AGENT_COMMAND_INDEX_SEARCH_TOOL_NAME = 'agent.command-index.search';
export const AGENT_DEVICE_MANIFEST_TOOL_NAME = 'device.factory-manifest.read';
export const COMMAND_BATCH_PROPOSAL_TOOL_NAME = 'command.batch.propose';
export const COMMAND_BATCH_DECLINE_TOOL_NAME = 'command.batch.decline';
export const COMMAND_HISTORY_TOOL_NAME = 'command.history';
export const RENDER_REQUEST_TOOL_NAME = 'render.request';
export const ANALYSIS_REQUEST_TOOL_NAME = 'analysis.request';

export const MAX_DISCOVERED_COMMAND_SCHEMAS = 8;
