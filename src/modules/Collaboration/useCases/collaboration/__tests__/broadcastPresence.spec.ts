import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type CollaborationState } from '../../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../../repositories/peerConnection';
import { collaborationStore } from '../../../stores/collaborationStore';
import { broadcastPresence } from '../broadcastPresence';

/**
 * `broadcastPresence` reaches into the WebRTC boundary exposed by
 * `sessionManagement`'s `sessionRuntimePrimitives`. Mock that boundary
 * entirely so these specs exercise only the guard clauses and the
 * identity-field merge, without opening a real peer connection.
 */
const mockRuntime = vi.hoisted(() => ({
    state: {
        peerManager: null as PeerConnectionManager | null,
    },
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));

const baseState: CollaborationState = {
    isEnabled: true,
    sessionId: 'session-1',
    localPeerId: 'local-1',
    localName: 'Alice',
    localColor: '#3b82f6',
    isHost: true,
    peers: [],
    connectionStatus: 'connected',
    error: null,
    quarantinedPeerIds: [],
};

describe('broadcastPresence', () => {
    let broadcastSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        broadcastSpy = vi.fn();
        mockRuntime.state.peerManager = { broadcastPresence: broadcastSpy } as unknown as PeerConnectionManager;
        collaborationStore.set({ ...baseState });
    });

    it('is a no-op when there is no active peer manager', () => {
        mockRuntime.state.peerManager = null;

        expect(() => broadcastPresence({ cursorBeat: 4 })).not.toThrow();
        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('is a no-op when the store has no local peer id', () => {
        collaborationStore.set(null);

        broadcastPresence({ cursorBeat: 4 });

        expect(broadcastSpy).not.toHaveBeenCalled();
    });

    it('broadcasts a presence message merging identity fields from the store with the given delta', () => {
        broadcastPresence({ cursorBeat: 42, cursorTrackId: 'track-9' });

        expect(broadcastSpy).toHaveBeenCalledWith({
            type: 'presence',
            data: {
                cursorBeat: 42,
                cursorTrackId: 'track-9',
                peerId: 'local-1',
                name: 'Alice',
                color: '#3b82f6',
            },
        });
    });

    it('omits fields absent from the delta rather than nulling them', () => {
        broadcastPresence({});

        expect(broadcastSpy).toHaveBeenCalledWith({
            type: 'presence',
            data: {
                peerId: 'local-1',
                name: 'Alice',
                color: '#3b82f6',
            },
        });
    });
});
