import { updateWorkspaceState } from '../../../repositories/updateWorkspaceState';

export const setTrackListWidth = (width: number): void => {
    updateWorkspaceState({ trackListWidth: width });
};
