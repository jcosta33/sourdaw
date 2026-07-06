import { automationDrawModeState } from './automationDrawMode';

/**
 * Check if a draw session is currently active.
 */
export function isDrawSessionActive(): boolean {
    return automationDrawModeState.activeSession !== null;
}
