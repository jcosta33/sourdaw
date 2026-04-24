import { updateWorkspaceState } from '../../../repositories/workspace';

export const setTrackListWidth = (width: number): void => {
    updateWorkspaceState({ trackListWidth: width });
};
