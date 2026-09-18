/**
 * Withdraw a client's authority by stamping it, never by deleting it.
 *
 * A deleted grant reads exactly like one that was never issued, and admission
 * would answer the revoked client `grant-missing` — the same thing it tells a
 * stranger. The record stays so the refusal stays `grant-revoked`, and so the
 * session can still say what this client once held and when it stopped.
 */

import { type ExternalClientGrant } from '../models/ExternalClientContract';
import { externalClientSessionStore, readExternalClientSession } from '../stores/externalClientSessionStore';

export function revokeExternalClientGrant(clientId: string): ExternalClientGrant | null {
    const session = readExternalClientSession();
    const grant = session.grants[clientId];
    if (!grant || grant.revokedAt !== null) {
        return null;
    }
    const revoked: ExternalClientGrant = { ...grant, revokedAt: Date.now() };
    externalClientSessionStore.set({ ...session, grants: { ...session.grants, [clientId]: revoked } });
    return revoked;
}
