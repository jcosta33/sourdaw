import { type PeerId, type PeerMessage } from '../models/CollaborationTypes';
import { collaborationStore } from '../stores/collaborationStore';
import { type PeerConnectionManager } from '../repositories/peerConnection';

export type PeerRole = 'host' | 'editor' | 'transport-controller' | 'viewer';

export type RoleGrant = {
    peerId: PeerId;
    role: PeerRole;
    grantedBy: PeerId;
    epoch: number;
    timestamp: number;
};

type PermissionMessage =
    | { type: 'role.grant'; grant: RoleGrant };

/** Capabilities per role. */
const ROLE_CAPABILITIES: Record<PeerRole, Set<string>> = {
    host: new Set(['edit', 'transport', 'grant-roles', 'approve-join', 'kick']),
    editor: new Set(['edit', 'transport']),
    'transport-controller': new Set(['transport']),
    viewer: new Set([]),
};

/**
 * Permission system for collaboration sessions.
 *
 * Roles are granted by the host and enforced locally — each peer
 * filters incoming mutations based on the sender's role.
 */
export class PermissionManager {
    private peerManager: PeerConnectionManager;
    private grants = new Map<PeerId, RoleGrant>();
    private epoch = 0;

    constructor(peerManager: PeerConnectionManager) {
        this.peerManager = peerManager;
    }

    /** Grant a role to a peer (host only). */
    grantRole(peerId: PeerId, role: PeerRole): void {
        const state = collaborationStore.value;
        if (!state?.isHost || !state.localPeerId) {
            return;
        }

        this.epoch++;
        const grant: RoleGrant = {
            peerId,
            role,
            grantedBy: state.localPeerId,
            epoch: this.epoch,
            timestamp: Date.now(),
        };

        this.grants.set(peerId, grant);

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: '__permissions__',
            data: JSON.stringify({ type: 'role.grant', grant } satisfies PermissionMessage),
        });
    }

    /** Check if a peer has a specific capability. */
    hasCapability(peerId: PeerId, capability: string): boolean {
        const state = collaborationStore.value;

        // Local host always has all capabilities
        if (peerId === state?.localPeerId && state?.isHost) {
            return true;
        }

        const grant = this.grants.get(peerId);
        if (!grant) {
            return false;
        }

        // Host role has all capabilities regardless of who it is
        if (grant.role === 'host') {
            return true;
        }

        return ROLE_CAPABILITIES[grant.role]?.has(capability) ?? false;
    }

    /** Check if a peer can edit the project. */
    canEdit(peerId: PeerId): boolean {
        return this.hasCapability(peerId, 'edit');
    }

    /** Check if a peer can control transport. */
    canControlTransport(peerId: PeerId): boolean {
        return this.hasCapability(peerId, 'transport');
    }

    /** Get the role of a peer. */
    getRole(peerId: PeerId): PeerRole | null {
        const state = collaborationStore.value;
        if (peerId === state?.localPeerId && state?.isHost) {
            return 'host';
        }
        return this.grants.get(peerId)?.role ?? null;
    }

    /** Handle an incoming permission message. */
    handleMessage(peerId: PeerId, message: PeerMessage): void {
        if (message.type !== 'crdt-sync' || message.docId !== '__permissions__') {
            return;
        }

        let data: PermissionMessage;
        try {
            data = JSON.parse(message.data) as PermissionMessage;
        } catch {
            return;
        }

        if (data.type === 'role.grant') {
            // Only accept grants from a peer the store recognises as the host.
            const state = collaborationStore.value;
            const senderIsHost = state?.peers.find((p) => p.id === peerId && p.isHost);
            if (!senderIsHost) {
                return;
            }
            const existing = this.grants.get(data.grant.peerId);
            if (!existing || data.grant.epoch > existing.epoch) {
                this.grants.set(data.grant.peerId, data.grant);
            }
        }
    }

    /** Clear all grants (on session leave). */
    clear(): void {
        this.grants.clear();
        this.epoch = 0;
    }
}
