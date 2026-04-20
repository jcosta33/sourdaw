import { updateWorkspaceState } from '../../workspaceState';

/**
 * Set the width of the Session view in side-by-side mode (D1).
 */
export function setSessionViewWidth(width: number): void {
    updateWorkspaceState({ sessionViewWidth: width });
}
