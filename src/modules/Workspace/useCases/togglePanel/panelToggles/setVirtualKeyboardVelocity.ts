import { updateWorkspaceState } from '../../../repositories/workspace';

export const setVirtualKeyboardVelocity = (velocity: number): void => {
    updateWorkspaceState({ virtualKeyboardVelocity: Math.max(1, Math.min(127, velocity)) });
};
