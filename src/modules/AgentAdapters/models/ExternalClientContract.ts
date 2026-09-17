/**
 * The one contract every external client speaks, whatever carries it.
 *
 * MCP, a CLI, a macro runner, a control surface and a remote peer are five
 * transports over the same versioned surface: the same operation names, the
 * same schema version, the same grant. Stating it once is what keeps a second
 * client from arriving with its own dialect and its own idea of who approved
 * what.
 *
 * Three facts are carried here rather than left to each adapter. A transport
 * that something outside this machine can reach is off until a person here
 * turns it on. An operation is reachable only through a grant that names it,
 * names the project it was issued against, and can be revoked. And a grant is
 * held by whoever holds its secret, never by whoever claims its name: the
 * client id is an address, and an address is not authority. None of the three
 * is a policy an adapter may soften, because an adapter is the thing on the far
 * end of the wire.
 */

import { digest } from '#/utils/canonicalDigest';

/** The version an external client must speak to be admitted at all. */
export const EXTERNAL_CLIENT_CONTRACT_SCHEMA_VERSION = 1;

export const EXTERNAL_CLIENT_TRANSPORTS = ['mcp', 'cli', 'macro', 'hardware', 'remote'] as const;

/**
 * The transports something off this machine can open.
 *
 * They are disabled until a local approval enables them. The other three still
 * need a grant — they are reachable only by something already running here, so
 * the grant alone is the local approval.
 */
export const EXTERNALLY_REACHABLE_TRANSPORTS = ['mcp', 'remote'] as const;

export const EXTERNAL_CLIENT_OPERATIONS = [
    'project.query',
    'project.discover',
    'agent.capabilities',
    'command.preview',
    'command.approval',
    'receipt.read',
] as const;

/**
 * The width of a grant token, in bytes drawn from the platform CSPRNG.
 *
 * 32 is the width a guess has to cross, and it is the whole of the client's
 * authority: nothing else about a request is secret, because a client id, a
 * transport name and an operation name are all published or guessable.
 */
export const EXTERNAL_CLIENT_TOKEN_BYTES = 32;

export type ExternalClientTransport = (typeof EXTERNAL_CLIENT_TRANSPORTS)[number];

export type ExternalClientOperation = (typeof EXTERNAL_CLIENT_OPERATIONS)[number];

/**
 * One client's authority, bound to the project it was issued against.
 *
 * The token itself is never a field here. Only its digest is kept, so a session
 * dump, a log line or a store read cannot hand anyone the bearer secret; the
 * issuing call is the one and only place the token exists in the clear.
 *
 * A revocation stamps `revokedAt` instead of removing the record: a grant that
 * disappears cannot tell a later reader that the client ever held it, and
 * "never granted" and "granted then revoked" are different facts.
 */
export type ExternalClientGrant = {
    clientId: string;
    transport: ExternalClientTransport;
    operations: readonly ExternalClientOperation[];
    activeProjectId: string;
    tokenDigest: string;
    issuedAt: number;
    revokedAt: number | null;
};

export type ExternalClientRequest = {
    clientId: string;
    transport: ExternalClientTransport;
    operation: ExternalClientOperation;
    schemaVersion: number;
    projectId: string;
    grantToken: string;
    payload: unknown;
};

/**
 * One operation as this module publishes it, with the owner contract answering it.
 *
 * `deferred` means the manifest carries no contract for the operation, so
 * nothing published can answer it. That is a different fact from a refusal,
 * and admission reports it as one.
 */
export type NormalizedExternalClientOperation = {
    name: ExternalClientOperation;
    contractId: string;
    contractVersion: string;
    availability: 'available' | 'deferred';
};

export type NormalizedExternalClientContract = {
    schemaVersion: number;
    operations: readonly NormalizedExternalClientOperation[];
};

/** Why admission refused. Each reason names one gate, so a client can act on it. */
export type ExternalClientAdmissionRefusalReason =
    | 'transport-disabled'
    | 'grant-missing'
    | 'grant-revoked'
    | 'operation-not-granted'
    | 'project-scope-mismatch'
    | 'schema-version-unsupported'
    | 'operation-not-published';

/**
 * Every refusal an adapter can report.
 *
 * `payload-invalid` is an adapter's own refusal, not admission's: the request
 * was admitted and its body then failed the operation's argument contract.
 */
export type ExternalClientRefusalReason = ExternalClientAdmissionRefusalReason | 'payload-invalid';

export type ExternalClientAdmission =
    | { status: 'admitted'; grant: ExternalClientGrant; operation: NormalizedExternalClientOperation }
    | { status: 'refused'; reason: ExternalClientAdmissionRefusalReason };

/**
 * Whether a transport could be opened.
 *
 * `native-transport-unavailable` is not a refusal of the caller's authority: it
 * says this build has no shell to carry the transport at all, which is why the
 * answer is a status rather than a thrown error or a silent no-op.
 */
export type ExternalClientTransportEnablement =
    { status: 'enabled' } | { status: 'refused'; reason: 'native-transport-unavailable' };

export function isExternallyReachableTransport(transport: ExternalClientTransport): boolean {
    return EXTERNALLY_REACHABLE_TRANSPORTS.some((reachable) => reachable === transport);
}

/**
 * The stored form of a grant token.
 *
 * Both the issuing call and every admission run the token through here, so the
 * session holds one derived value that no reader can spend and admission still
 * compares the presented token against something.
 */
export function externalClientTokenDigest(token: string): string {
    return digest(token);
}
