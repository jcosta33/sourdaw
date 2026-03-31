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
    | { type: 'role.grant'; grant: RoleGrant }
    | { type: 'role.request'; peerId: PeerId; requestedRole: PeerRole; name: string };

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
    private onJoinRequest: ((peerId: PeerId, name: string, role: PeerRole) => void) | null = null;

    constructor(peerManager: PeerConnectionManager) {
        this.peerManager = peerManager;
    }

    /** Set the callback for incoming join/role requests (host only). */
    setJoinRequestHandler(handler: (peerId: PeerId, name: string, role: PeerRole) => void): void {
        this.onJoinRequest = handler;
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
    handleMessage(_peerId: PeerId, message: PeerMessage): void {
        if (message.type !== 'crdt-sync' || message.docId !== '__permissions__') {
            return;
        }

        const data = JSON.parse(message.data) as PermissionMessage;

        if (data.type === 'role.grant') {
            const existing = this.grants.get(data.grant.peerId);
            if (!existing || data.grant.epoch > existing.epoch) {
                this.grants.set(data.grant.peerId, data.grant);
            }
        } else if (data.type === 'role.request') {
            if (this.onJoinRequest) {
                this.onJoinRequest(data.peerId, data.name, data.requestedRole);
            }
        }
    }

    /** Request a role from the host (non-host peers). */
    requestRole(requestedRole: PeerRole): void {
        const state = collaborationStore.value;
        if (!state?.localPeerId) {
            return;
        }

        const msg: PermissionMessage = {
            type: 'role.request',
            peerId: state.localPeerId,
            requestedRole,
            name: state.localName,
        };

        this.peerManager.broadcastCrdtSync({
            type: 'crdt-sync',
            docId: '__permissions__',
            data: JSON.stringify(msg),
        });
    }

    /** Get all current role grants. */
    getAllGrants(): RoleGrant[] {
        return Array.from(this.grants.values());
    }

    /** Clear all grants (on session leave). */
    clear(): void {
        this.grants.clear();
        this.epoch = 0;
        this.onJoinRequest = null;
    }
}
