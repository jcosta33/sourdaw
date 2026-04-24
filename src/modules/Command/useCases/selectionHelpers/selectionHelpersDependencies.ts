import { getMarkerState, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { getTransportStoreValue, seekPlayhead } from '#/modules/Transport/useCases';
import { workspaceStore } from '#/modules/Workspace/stores';

export const selectionHelpersDependencies = {
    getTrackStoreState,
    getMarkerState,
    getTransportStoreValue,
    seekPlayhead,
    getWorkspaceState: () => workspaceStore.value,
} as const;
