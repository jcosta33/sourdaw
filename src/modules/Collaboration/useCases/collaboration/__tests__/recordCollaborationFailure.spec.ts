import { describe, it, expect, beforeEach } from 'vitest';

import { type CollaborationState } from '../../../models/CollaborationTypes';
import { collaborationStore } from '../../../stores/collaborationStore';
import { recordCollaborationFailure } from '../recordCollaborationFailure';

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

describe('recordCollaborationFailure', () => {
    beforeEach(() => {
        collaborationStore.set({ ...baseState });
    });

    it("surfaces an Error's message without disturbing the live session", () => {
        recordCollaborationFailure(new Error('ICE negotiation failed'));

        expect(collaborationStore.value).toEqual({ ...baseState, error: 'ICE negotiation failed' });
    });

    it('stringifies a thrown value that is not an Error', () => {
        // A rejection carrying a bare string still has to read as something in
        // the panel's error row rather than as an empty message.
        recordCollaborationFailure('clipboard read denied');

        expect(collaborationStore.value?.error).toBe('clipboard read denied');
    });

    it('does nothing when no session state is held', () => {
        collaborationStore.set(null);

        recordCollaborationFailure(new Error('ICE negotiation failed'));

        expect(collaborationStore.value).toBeNull();
    });
});
