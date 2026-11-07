import { type ToolSchema } from '../models/ToolDefinitions';

import { getAgentToolCatalogSchemas } from './agentToolCatalog';

let applicationOwnedToolSchemas: readonly ToolSchema[] | null = null;

/**
 * The tool schemas the application-owned loop offers, built on first use and
 * kept. Not built when this module loads: the catalog reads the factory preset
 * library, which may hold presets the composition root registers only after
 * every module has loaded.
 */
export function getApplicationOwnedToolSchemas(): readonly ToolSchema[] {
    applicationOwnedToolSchemas ??= getAgentToolCatalogSchemas();
    return applicationOwnedToolSchemas;
}
