import {
    type Doc,
    type SyncState,
    generateSyncMessage,
    initSyncState,
    load,
    receiveSyncMessage,
    save,
} from '@automerge/automerge';

import { bytesToBase64 } from '#/utils/base64';

const MAX_HANDSHAKE_ROUNDS = 8;

type CreatePeerSyncMessagesInput = {
    /** The peer's document. Must share the receiver's document lineage. */
    remote: Doc<unknown>;
    /** The document the receiver holds when the exchange starts. */
    local: Doc<unknown>;
};

type SyncEndpoint = {
    doc: Doc<unknown>;
    state: SyncState;
};

/**
 * The ordered base64 `crdt-sync` payloads a peer sends until its changes are
 * actually on the wire.
 *
 * Automerge's first sync message is a handshake (heads + bloom filter) and
 * carries no changes at all, so a fixture that delivers a single message
 * exercises an empty sync round rather than a peer edit. This mirrors the
 * receiving side on throwaway copies and drives the exchange until the peer has
 * nothing left to send.
 *
 * Both documents are cloned first: `receiveSyncMessage` outdates the document it
 * is given, so mirroring against a live repository document would break it.
 */
export function createPeerSyncMessages({ remote, local }: CreatePeerSyncMessagesInput): string[] {
    const peer: SyncEndpoint = { doc: load<unknown>(save(remote)), state: initSyncState() };
    const mirror: SyncEndpoint = { doc: load<unknown>(save(local)), state: initSyncState() };
    const messages: string[] = [];

    for (let round = 0; round < MAX_HANDSHAKE_ROUNDS; round++) {
        const [peer_state_after_send, message] = generateSyncMessage(peer.doc, peer.state);
        peer.state = peer_state_after_send;
        if (!message) {
            return messages;
        }

        messages.push(bytesToBase64(message));
        [mirror.doc, mirror.state] = receiveSyncMessage(mirror.doc, mirror.state, message);

        const [mirror_state_after_send, reply] = generateSyncMessage(mirror.doc, mirror.state);
        mirror.state = mirror_state_after_send;
        if (!reply) {
            return messages;
        }
        [peer.doc, peer.state] = receiveSyncMessage(peer.doc, peer.state, reply);
    }

    throw new Error('Peer sync handshake did not settle');
}
