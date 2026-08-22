import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collaborationStore } from '../../../stores/collaborationStore';
import { createSession } from '../createSession';

/**
 * `createSession` orchestrates against the WebRTC/signaling boundary exposed
 * by `sessionManagement`'s `sessionRuntimePrimitives`. Mock that boundary
 * entirely so these specs exercise createSession's own orchestration and
 * store write without opening a real peer connection.
 */
const mockRuntime = vi.hoisted(() => ({
    cleanup: vi.fn<() => void>(),
    initialize: vi.fn<(assetOwnerId: string) => void>(),
    startPlayheadBroadcast: vi.fn<() => void>(),
    startBranchSync: vi.fn<(isHost: boolean) => void>(),
    generatePeerId: vi.fn<() => string>(),
    generateSessionId: vi.fn<() => string>(),
    pickPeerColor: vi.fn<(excludeColors: string[]) => string>(),
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));
vi.mock('../getCollaborationAssetOwnerId', () => ({
    getCollaborationAssetOwnerId: () => 'project-owner-1',
}));

describe('createSession', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        collaborationStore.set(null);
        mockRuntime.generatePeerId.mockReturnValue('peer-1');
        mockRuntime.generateSessionId.mockReturnValue('sess-1');
        mockRuntime.pickPeerColor.mockReturnValue('#3b82f6');
    });

    it('returns the generated session id', () => {
        mockRuntime.generateSessionId.mockReturnValue('sess-42');

        expect(createSession('Host')).toBe('sess-42');
    });

    it('resets prior runtime state before initializing the new host session', () => {
        createSession('Host');

        expect(mockRuntime.cleanup).toHaveBeenCalledTimes(1);
        expect(mockRuntime.initialize).toHaveBeenCalledExactlyOnceWith('project-owner-1');
        expect(mockRuntime.startPlayheadBroadcast).toHaveBeenCalledTimes(1);
        expect(mockRuntime.startBranchSync).toHaveBeenCalledWith(true);
    });

    it('requests a peer color that excludes no other peers for a fresh session', () => {
        createSession('Host');

        expect(mockRuntime.pickPeerColor).toHaveBeenCalledWith([]);
    });

    it('writes the new session into the collaboration store as the host with no peers yet', () => {
        createSession('Bob');

        expect(collaborationStore.value).toEqual({
            isEnabled: true,
            sessionId: 'sess-1',
            localPeerId: 'peer-1',
            localName: 'Bob',
            localColor: '#3b82f6',
            isHost: true,
            peers: [],
            connectionStatus: 'disconnected',
            error: null,
            quarantinedPeerIds: [],
        });
    });
});
