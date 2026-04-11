import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../stores/collaborationStore', () => {
    const value: { isHost: boolean; localPeerId: string; peers: { id: string; isHost: boolean }[] } = {
        isHost: true,
        localPeerId: 'local',
        peers: [],
    };
    return {
        collaborationStore: {
            get value() {
                return value;
            },
            set: vi.fn(),
        },
    };
});

import { PermissionManager } from './permissions';
import { type PeerConnectionManager } from '../repositories/peerConnection';

function makePeerManager(): PeerConnectionManager {
    return {
        broadcastCrdtSync: vi.fn(),
        sendCrdtSync: vi.fn(),
        sendCrdtSyncBuffered: vi.fn(),
    } as unknown as PeerConnectionManager;
}

describe('PermissionManager', () => {
    let manager: PermissionManager;
    let peer: PeerConnectionManager;

    beforeEach(() => {
        peer = makePeerManager();
        manager = new PermissionManager(peer);
    });

    it('local host has all capabilities', () => {
        expect(manager.canEdit('local')).toBe(true);
        expect(manager.canControlTransport('local')).toBe(true);
        expect(manager.getRole('local')).toBe('host');
    });

    it('peers without grants have no capabilities', () => {
        expect(manager.canEdit('peer-2')).toBe(false);
        expect(manager.getRole('peer-2')).toBeNull();
    });

    it('grantRole broadcasts and stores the grant', () => {
        manager.grantRole('peer-2', 'editor');

        expect(peer.broadcastCrdtSync).toHaveBeenCalled();
        expect(manager.canEdit('peer-2')).toBe(true);
        expect(manager.canControlTransport('peer-2')).toBe(true);
        expect(manager.getRole('peer-2')).toBe('editor');
    });

    it('viewer role has no capabilities', () => {
        manager.grantRole('peer-3', 'viewer');
        expect(manager.canEdit('peer-3')).toBe(false);
        expect(manager.canControlTransport('peer-3')).toBe(false);
    });

    it('clear() removes all grants', () => {
        manager.grantRole('peer-2', 'editor');
        manager.clear();
        expect(manager.canEdit('peer-2')).toBe(false);
    });
});
