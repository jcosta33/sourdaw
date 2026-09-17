/**
 * Grant one client a named set of operations over the open project.
 *
 * Three preconditions, all refusals rather than repairs. A transport something
 * outside this machine can reach must already have been enabled here, so a
 * grant can never be the thing that opens the door. A project must be open,
 * because the grant records which one it was issued against and admission
 * compares that back on every request — an unscoped grant would be authority
 * over whatever happens to be loaded later. And the client has to carry a
 * secret away from this call, because the alternative is authority that any
 * peer able to spell the client id already holds.
 *
 * The token is returned once and never stored: the session keeps its digest,
 * so this return value is the only copy anybody ever sees. A caller that loses
 * it revokes the grant and issues another.
 */

import {
    EXTERNAL_CLIENT_TOKEN_BYTES,
    externalClientTokenDigest,
    isExternallyReachableTransport,
    type ExternalClientGrant,
    type ExternalClientOperation,
    type ExternalClientTransport,
} from '../models/ExternalClientContract';
import { externalClientSessionStore, readExternalClientSession } from '../stores/externalClientSessionStore';

type IssueExternalClientGrantInput = {
    clientId: string;
    transport: ExternalClientTransport;
    operations: readonly ExternalClientOperation[];
};

type IssuedExternalClientGrant = { grant: ExternalClientGrant; token: string };

/** Platform CSPRNG bytes, rendered as lowercase hex so the token survives any transport. */
function mintGrantToken(): string {
    const bytes = new Uint8Array(EXTERNAL_CLIENT_TOKEN_BYTES);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function issueExternalClientGrant(input: IssueExternalClientGrantInput): IssuedExternalClientGrant | null {
    const session = readExternalClientSession();
    if (isExternallyReachableTransport(input.transport) && !session.enabledTransports.includes(input.transport)) {
        return null;
    }
    if (session.activeProjectId === null) {
        return null;
    }
    const token = mintGrantToken();
    const grant: ExternalClientGrant = {
        clientId: input.clientId,
        transport: input.transport,
        operations: [...input.operations],
        activeProjectId: session.activeProjectId,
        tokenDigest: externalClientTokenDigest(token),
        issuedAt: Date.now(),
        revokedAt: null,
    };
    externalClientSessionStore.set({ ...session, grants: { ...session.grants, [grant.clientId]: grant } });
    return { grant, token };
}
