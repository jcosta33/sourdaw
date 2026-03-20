/**
 * Workspace Queries — use case layer exposing workspace state
 * to cross-module consumers.
 */

import { workspaceStore } from '../stores/workspaceStore';
import { type WorkspaceState } from '../models/WorkspaceState';
import { type EditingTool, TOOL_SHORTCUTS, TOOL_LABELS } from '../models/EditingTool';
import {
    type Preferences,
    defaultPreferences,
    TRACK_HEIGHT_VALUES,
    gridSnapBeats,
    type GridSnapOption,
} from '../models/Preferences';

export type { WorkspaceState, EditingTool, Preferences, GridSnapOption };
export { TOOL_SHORTCUTS, TOOL_LABELS, defaultPreferences, TRACK_HEIGHT_VALUES, gridSnapBeats };

/** Get the current workspace state snapshot. */
export function getWorkspaceState(): WorkspaceState | null {
    return workspaceStore.value;
}

/** Get the current workspace store value (alias for direct snapshot access). */
export function getWorkspaceStoreValue(): WorkspaceState | null {
    return workspaceStore.value;
}

/** Subscribe to workspace store changes. */
export function subscribeToWorkspace(callback: () => void): () => void {
    return workspaceStore.subscribe(callback);
}

/** Set the workspace store value. */
export function setWorkspaceStoreValue(state: WorkspaceState): void {
    workspaceStore.set(state);
}
