/**
 * Workspace Queries — use case layer exposing Workspace constants
 * and preferences to cross-module consumers.
 */

export { gridSnapBeats, TRACK_HEIGHT_VALUES, defaultPreferences } from '../models/Preferences';
export type { Preferences, GridSnapOption } from '../models/Preferences';
export { type EditingTool, TOOL_SHORTCUTS } from '../models/EditingTool';
export { getWorkspaceState } from '../repositories/workspaceRepository';
