import { automationStore } from '../stores/automationStore';

import { automationDrawModeState } from './automationDrawMode';

/** Flush the accumulated draw-state to the CRDT store. */
export function flushPendingDrawState(): void {
    const activeSession = automationDrawModeState.activeSession;
    if (activeSession === null || activeSession.pendingState === null) {
        return;
    }

    automationStore.set(activeSession.pendingState);
    activeSession.pendingState = null;
    activeSession.rafId = null;
}
