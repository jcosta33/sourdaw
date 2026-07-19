import { describe, it, expect, vi, beforeEach } from 'vitest';

type StoreShape = { isHost: boolean; localPeerId: string; peers: { id: string; isHost: boolean }[] };

const storeState = vi.hoisted(() => {
    const value: StoreShape = { isHost: true, localPeerId: 'local', peers: [] };
    return { value };
});

vi.mock('../../stores/collaborationStore', () => ({
    collaborationStore: {
        get value() {
            return storeState.value;
        },
        set: vi.fn(),
    },
}));

import { type PeerMessage } from '../../models/CollaborationTypes';
import { type PeerConnectionManager } from '../../repositories/peerConnection';
import { PermissionManager, type RoleGrant } from '../permissions';

function makePeerManager(): PeerConnectionManager {
    return {
        broadcastCrdtSync: vi.fn(),
        sendCrdtSync: vi.fn(),
        sendCrdtSyncBuffered: vi.fn(),
    } as unknown as PeerConnectionManager;
}

function grantMessage(grant: RoleGrant): PeerMessage {
    return {
        type: 'crdt-sync',
        docId: '__permissions__',
        data: JSON.stringify({ type: 'role.grant', grant }),
    };
}

describe('PermissionManager', () => {
    let manager: PermissionManager;
    let peer: PeerConnectionManager;

    beforeEach(() => {
        storeState.value = { isHost: true, localPeerId: 'local', peers: [] };
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

    describe('handleMessage (receive path)', () => {
        const grant: RoleGrant = {
            peerId: 'peer-9',
            role: 'editor',
            grantedBy: 'host-peer',
            epoch: 1,
            timestamp: 1000,
        };

        it('applies a role.grant received from a peer the store marks as host', () => {
            // The grant arrives from 'host-peer', which the store recognises as host.
            storeState.value = {
                isHost: false,
                localPeerId: 'local',
                peers: [{ id: 'host-peer', isHost: true }],
            };

            manager.handleMessage('host-peer', grantMessage(grant));

            expect(manager.getRole('peer-9')).toBe('editor');
            expect(manager.canEdit('peer-9')).toBe(true);
        });

        it('rejects a role.grant from a sender the store does not mark as host (senderIsHost gate)', () => {
            // 'imposter' sends a grant but is not flagged host in the peer list.
            storeState.value = {
                isHost: false,
                localPeerId: 'local',
                peers: [
                    { id: 'host-peer', isHost: true },
                    { id: 'imposter', isHost: false },
                ],
            };

            manager.handleMessage('imposter', grantMessage(grant));

            expect(manager.getRole('peer-9')).toBeNull();
            expect(manager.canEdit('peer-9')).toBe(false);
        });

        it('ignores messages on a docId other than __permissions__', () => {
            storeState.value = {
                isHost: false,
                localPeerId: 'local',
                peers: [{ id: 'host-peer', isHost: true }],
            };

            manager.handleMessage('host-peer', {
                type: 'crdt-sync',
                docId: 'something-else',
                data: JSON.stringify({ type: 'role.grant', grant }),
            });

            expect(manager.getRole('peer-9')).toBeNull();
        });

        it('keeps the newer grant when a stale (lower-epoch) grant arrives', () => {
            storeState.value = {
                isHost: false,
                localPeerId: 'local',
                peers: [{ id: 'host-peer', isHost: true }],
            };

            const fresh: RoleGrant = { ...grant, role: 'editor', epoch: 5 };
            const stale: RoleGrant = { ...grant, role: 'viewer', epoch: 2 };

            manager.handleMessage('host-peer', grantMessage(fresh));
            manager.handleMessage('host-peer', grantMessage(stale));

            // The stale viewer grant must not overwrite the fresher editor grant.
            expect(manager.getRole('peer-9')).toBe('editor');
            expect(manager.canEdit('peer-9')).toBe(true);
        });
    });
});
