/**
 * Workspace Queries — use case layer exposing Workspace constants
 * and preferences to cross-module consumers.
 */

import { inject } from '#/infra/di/inject';
import { getWorkspaceState as repoGetWorkspaceState } from '../repositories/workspace';
import { type WorkspaceState } from '../models/WorkspaceState';

export { gridSnapBeats, TRACK_HEIGHT_VALUES, defaultPreferences } from '../models/Preferences';
export type { Preferences, GridSnapOption } from '../models/Preferences';
export { type EditingTool, TOOL_SHORTCUTS } from '../models/EditingTool';
export type { WorkspaceState };

export const getWorkspaceState = inject({ repoGetWorkspaceState })(
    ({ repoGetWorkspaceState }) =>
        function getWorkspaceState(): WorkspaceState | null {
            return repoGetWorkspaceState();
        }
);
