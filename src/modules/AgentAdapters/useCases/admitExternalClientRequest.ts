/**
 * Whether one external request may be answered at all.
 *
 * Pure over the session and the normalized contract: it reads, it decides, it
 * writes nothing. Every adapter calls it first and routes nothing until it
 * answers `admitted`, so the gates below are the whole of what an external
 * client has to pass, wherever it connected from.
 *
 * The order is deliberate. Transport comes first, so a disabled door refuses
 * before anything about the caller is consulted. Identity comes next: a client
 * is the grant whose secret it can present, so a name without the token and a
 * name nobody granted are the same refusal — `grant-missing` — and a peer
 * spraying client ids learns nothing about which ones exist. Revocation is
 * reported only to the holder of the token, because only the holder had
 * anything to lose. The schema version comes before the operation, because a
 * client speaking a version this build does not know cannot be told anything
 * true about which operations it holds.
 */

import {
    EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION,
    externalClientTokenDigest,
    isExternallyReachableTransport,
    type ExternalClientAdmission,
    type ExternalClientGrant,
    type ExternalClientRequest,
} from '../models/ExternalClientContract';
import { readExternalClientSession } from '../stores/externalClientSessionStore';

import { normalizeExternalClientContract } from './normalizeExternalClientContract';

/**
 * The presented token against the stored digest.
 *
 * The comparison is over digests, so what an early exit could time is how far
 * two SHA-256 outputs agree — a figure nobody can walk back to a token.
 */
function presentsGrantToken(grant: ExternalClientGrant, grantToken: string): boolean {
    return grantToken.length > 0 && externalClientTokenDigest(grantToken) === grant.tokenDigest;
}

export function admitExternalClientRequest(request: ExternalClientRequest): ExternalClientAdmission {
    const session = readExternalClientSession();
    if (isExternallyReachableTransport(request.transport) && !session.enabledTransports.includes(request.transport)) {
        return { status: 'refused', reason: 'transport-disabled' };
    }

    const grant = session.grants[request.clientId];
    if (!grant || grant.transport !== request.transport || !presentsGrantToken(grant, request.grantToken)) {
        return { status: 'refused', reason: 'grant-missing' };
    }
    if (grant.revokedAt !== null) {
        return { status: 'refused', reason: 'grant-revoked' };
    }

    if (request.schemaVersion !== EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION) {
        return { status: 'refused', reason: 'schema-version-unsupported' };
    }
    if (!grant.operations.includes(request.operation)) {
        return { status: 'refused', reason: 'operation-not-granted' };
    }

    // Both sides, because they fail differently: the request naming another
    // project is a client reaching outside its grant, and the session having
    // moved on is a grant outliving the project it was issued against.
    if (request.projectId !== grant.activeProjectId || session.activeProjectId !== grant.activeProjectId) {
        return { status: 'refused', reason: 'project-scope-mismatch' };
    }

    const operation = normalizeExternalClientContract().operations.find((entry) => entry.name === request.operation);
    if (!operation || operation.availability === 'deferred') {
        return { status: 'refused', reason: 'operation-not-published' };
    }

    return { status: 'admitted', grant, operation };
}
