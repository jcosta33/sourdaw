import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { type CollaborationState } from '../../../models/CollaborationTypes';
import { collaborationStore } from '../../../stores/collaborationStore';
import { clearCollaborationFailure } from '../clearCollaborationFailure';

const baseState: CollaborationState = {
    isEnabled: true,
    sessionId: 'session-1',
    localPeerId: 'host-local',
    localName: 'Host',
    localColor: '#3b82f6',
    isHost: true,
    peers: [],
    connectionStatus: 'connected',
    error: null,
    quarantinedPeerIds: [],
};

describe('clearCollaborationFailure', () => {
    beforeEach(() => {
        collaborationStore.set({ ...baseState });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('clears a surfaced failure while preserving the rest of the session state', () => {
        collaborationStore.set({ ...baseState, error: 'Invalid answer' });

        clearCollaborationFailure();

        expect(collaborationStore.value).toEqual(baseState);
    });

    it('leaves the store value untouched when no failure is displayed', () => {
        // Every attempt starts by clearing, and the common case has nothing to
        // clear. Writing an equal-but-new object there would wake every
        // subscriber for no state change.
        const state: CollaborationState = { ...baseState, error: null };
        collaborationStore.set(state);
        const set = vi.spyOn(collaborationStore, 'set');

        clearCollaborationFailure();

        expect(set).not.toHaveBeenCalled();
        expect(collaborationStore.value).toBe(state);
    });

    it('does nothing when no session state is held', () => {
        collaborationStore.set(null);

        clearCollaborationFailure();

        expect(collaborationStore.value).toBeNull();
    });
});
