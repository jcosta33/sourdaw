/**
 * The one contract every external client speaks, whatever carries it.
 *
 * MCP, a CLI, a macro runner, a control surface and a remote peer are five
 * transports over the same versioned surface: the same operation names, the
 * same schema version, the same grant. Stating it once is what keeps a second
 * client from arriving with its own dialect and its own idea of who approved
 * what.
 *
 * Two facts are carried here rather than left to each adapter. A transport that
 * something outside this machine can reach is off until a person here turns it
 * on, and an operation is reachable only through a grant that names it, names
 * the project it was issued against, and can be revoked. Neither is a policy an
 * adapter may soften, because an adapter is the thing on the far end of the
 * wire.
 */

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

export type ExternalClientTransport = (typeof EXTERNAL_CLIENT_TRANSPORTS)[number];

export type ExternalClientOperation = (typeof EXTERNAL_CLIENT_OPERATIONS)[number];

/**
 * One client's authority, bound to the project it was issued against.
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
    issuedAt: number;
    revokedAt: number | null;
};

export type ExternalClientRequest = {
    clientId: string;
    transport: ExternalClientTransport;
    operation: ExternalClientOperation;
    schemaVersion: number;
    projectId: string;
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

export function isExternallyReachableTransport(transport: ExternalClientTransport): boolean {
    return EXTERNALLY_REACHABLE_TRANSPORTS.some((reachable) => reachable === transport);
}
