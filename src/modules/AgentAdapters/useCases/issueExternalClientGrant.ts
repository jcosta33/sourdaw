/**
 * Grant one client a named set of operations over the open project.
 *
 * Two preconditions, both refusals rather than repairs. A transport something
 * outside this machine can reach must already have been enabled here, so a
 * grant can never be the thing that opens the door. And a project must be
 * open, because the grant records which one it was issued against and
 * admission compares that back on every request — an unscoped grant would be
 * authority over whatever happens to be loaded later.
 */

import {
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

export function issueExternalClientGrant(input: IssueExternalClientGrantInput): ExternalClientGrant | null {
    const session = readExternalClientSession();
    if (isExternallyReachableTransport(input.transport) && !session.enabledTransports.includes(input.transport)) {
        return null;
    }
    if (session.activeProjectId === null) {
        return null;
    }
    const grant: ExternalClientGrant = {
        clientId: input.clientId,
        transport: input.transport,
        operations: [...input.operations],
        activeProjectId: session.activeProjectId,
        issuedAt: Date.now(),
        revokedAt: null,
    };
    externalClientSessionStore.set({ ...session, grants: { ...session.grants, [grant.clientId]: grant } });
    return grant;
}
