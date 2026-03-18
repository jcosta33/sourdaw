import { useSyncExternalStore } from 'react';
import { workspaceStore } from '../../stores/workspaceStore';
import { defaultWorkspaceState, type WorkspaceState } from '../../models/WorkspaceState';

export const useWorkspaceState = (): WorkspaceState => {
    return useSyncExternalStore(
        (onChange) => workspaceStore.subscribe(() => onChange()),
        () => workspaceStore.value ?? defaultWorkspaceState,
        () => workspaceStore.value ?? defaultWorkspaceState
    );
};
