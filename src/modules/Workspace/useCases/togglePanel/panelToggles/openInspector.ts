import { updateWorkspaceState } from '../../../repositories/workspace';

export function openInspector(): void {
    updateWorkspaceState({ inspectorOpen: true });
}